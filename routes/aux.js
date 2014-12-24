var request  = require('request');
var crypto   = require('crypto');
var Firebase = require('firebase');

var spotify  = require('./spotify');
var models   = require('../models.js');

var firebaseRef = new Firebase(process.env.FIREBASE_URL);
firebaseRef.authWithCustomToken(process.env.FIREBASE_SECRET, function(err) {
    if(err) {
        console.log('Couldn\'t authenticate', err);
    } else {
        console.log('Authenticated successfully');
    }
});

// Milliseconds between voting rounds
var voteWaitTime = 30000;
exports.voteWaitTime = this.voteWaitTime;

exports.get_user_id = function(req, res) {
    res.status(200).json({user_id: req.session.user_id});
};

exports.create = function(req, res) {
    res.status(200).render('old');
};

exports.index = function(req, res) {
    var layout = req.query.layout !== false;
    
    if(layout === false) {
        res.status(200).render('index', {layout: false});
    } else {
        res.status(200).render('index');
    }
};

exports.find = function(req, res) {
    var layout = req.query.layout !== 'false' &&
                 req.query.layout !== false;
    if(layout === false) {
        res.status(200).render('find', {layout: false});
    } else {
        res.status(200).render('find');
    }
}

var generateUserId = function(group_id) {
    return crypto.createHash('md5').update(group_id + new Date()).digest('hex');
}

exports.show_group = function(req, res) {
    var layout = req.query.layout !== 'false' &&
                 req.query.layout !== false;
    
    var renderGroup = function(err, groupData) {
        if(!err) {
            if(groupData) {
                if(layout === false) {
                    groupData.layout = false;
                }
                
                // when someone loads a group page, they automatically
                // join that group. session object reflects that
                if(!req.session.user_id) {
                    req.session.group_id = req.params.group_id;
                    req.session.user_id  = generateUserId(req.session.group_id);
                }
                
                // might as well refresh the access token here
                req.session.access_token = groupData.group_access_token;
                req.session.refresh_token = groupData.group_refresh_token;
                
                // render the group page with the group data
                res.status(200).render('group', groupData);
            } else {
                // no group existed, send back a 404
                res.send(404);
            }
        } else {
            console.log('error rendering group', err);
            console.log('post error:   ', groupData);
            res.status(500).send(err);
        }
    };
    
    // send the query
    models.Group.where({_id: req.params.group_id}).findOne(renderGroup);
};

/**
 * Renders the html for a single voting-object given a passed in
 * JSON hash (req.query.json)
 */
exports.render_voting_track = function(req, res) {
    var hash = JSON.parse(req.query.json);
    if(!hash.id) {
        res.status(404).send({err: 'no id specified'});
        return;
    }
    hash.layout = false;
    hash.voted_for = hash.voter_ids &&
                     hash.voter_ids[req.session.user_id] !== undefined;
    res.render('partials/voting-object', hash);
};

/**
 * Creates a group and stores it in the firebase and its location
 * data on Mongo
 *
 *   'user_id' : Spotify user ID
 *   'name'    : Group name
 *   'location': Location object
 *   'public'  : true if public playlist
 */
exports.create_group = function(req, res) {
    var user_id  = req.body.user_id,
        name     = req.body.name,
        location = req.body.location,
        public   = req.body.public || false;
    
    var playlistOptions = {
        user_id: user_id,
        name: name,
        public: public,
        access_token: req.session.access_token,
    };
    
    // create the playlist, then create and store the group
    spotify.create_playlist(playlistOptions, function(err, response, body) {
        if(!err &&  (response.statusCode === 200 || response.statusCode === 201)) {
            // if the playlist is created successfully, build
            // the group object and store it
            
            // store the location object on mongo
            models.Group.create({
                user_id: user_id,
                name: name,
                latitude: location.latitude,
                longitude: location.longitude,
                group_access_token: req.session.access_token,
                group_refresh_token: req.session.refresh_token,
            }, function(err, group) {
                if(err) {
                    console.log('error saving group location', err);
                    res.status(500).send(err);
                    return;
                }
                
                // no error, create the group object to save
                // to firebase
              
                // first, build the playlist json
                var playlist = JSON.parse(body);
                var firebaseGroup = {
                    owner_id: user_id,
                    playlist_id: playlist.id,
                };

                // store the group object in firebase
                firebaseRef.child('groups').child(group.id).set(firebaseGroup);
                
                // add the group_id field to the object before returning
                // it as json
                res.status(201).json(group);
            });
        } else {
            console.log('There was a problem creating the group...');
            console.log(err, response.statusCode);
            res.status(500).send(err + ' ' + response + ' ' + body);
        }
    });
};

// 'q', 'type', 'limit', 'offset',
// and 'access_token'
// responds with object with html field and length field
exports.search = function(req, res) {
    var renderHtml = req.query.html === 'true' ||
                     req.query.html === true;
    
    var searchOptions = {
        q: req.query.q,
        type: req.query.type || 'artist,track,album',
        limit: req.query.limit || 10,
        offset: req.query.offset || 0,
        access_token: req.session.access_token,
        req: req,
    };
    
    spotify.search(searchOptions, function(err, response, body) {
        if(!err && response.statusCode === 200) {
            var searchJson = JSON.parse(body);
            searchJson.q = req.query.q;
            if(renderHtml) {
                res.render('partials/search-results',
                    {layout: false,
                    search_results: searchJson}, function(err, html) {
                  var length = 0;
                  for(var key in searchJson) {
                      length += searchJson[key].total;
                  }
                  searchJson.html = html;
                  searchJson.length = length;
                  res.status(200).json(searchJson);
                });
            } else {
                res.status(200).json(searchJson);
            }
        } else {
            res.status(response.statusCode).send(err);
        }
    });
};

/**
 * Finds groups near the specified location
 * 
 * latitude : latitude of the location
 * longitude: longitude of the location
 * distance : Sets a radius around the group's approximate position.
 *            Defaults to 1,000m
 */
exports.find_nearby_groups = function(req, res) {
    var renderHtml = req.query.html === 'true' ||
                     req.query.html === true;
    
    var latitude  = Number(req.query.latitude),
        longitude = Number(req.query.longitude);
    
    var distance = Number(req.query.distance || 500); // default to 1,000 m
    var sendData = function(err, data) {
        if(err) {
            console.log('error finding groups', err);
            res.status(500).send(err);
            return;
        }
        
        if(renderHtml) {
            res.render('partials/group-list',
                       {layout: false,
                        groups: data});
        } else {
            res.status(200).json(data);
        }
    };
    
    models.Group
        .where('longitude').gte(longitude - distance).lte(longitude + distance)
        .where('latitude').gte(latitude - distance).lte(latitude + distance)
        .exec(sendData);
};

exports.add_track_for_voting = function(req, res) {
    var track = JSON.parse(req.body.track);
    var trackId = track.id;
    var groupId = req.body.group_id;
    var voterId = req.session.user_id;
    
    var groupRef = firebaseRef.child('groups').child(groupId);
    
    var votingTracksRef = groupRef.child('voting_tracks');
    var trackRef = votingTracksRef.child(trackId);
    trackRef.set(track);
    var votersRef = trackRef.child('voter_ids');
    
    // If this is the first track we're adding, we want to go ahead and
    // kick off the timer. Otherwise, assume the timer's already running
    votingTracksRef.child('length').transaction(function(currentValue) {
        if(!currentValue) {
            // if the length is either 0 or undefined, go ahead and start
            // the timer and set it to 1
            var timeLeftRef = groupRef.child('time_left');
            // decrement time left every second, starting from voteWatiTime
            var interval = setInterval(function() {
                timeLeftRef.transaction(function(current) {
                    // if there's no time on the clock, get it running
                    if(current === undefined || current === null) return parseInt(voteWaitTime);
                    // When time's up, we clear the interval and set the reference's
                    // value to 0. We catch this value on the front-end, and
                    // send a new request to the add_track_to_playlist handler
                    if(current <= 0) {
                        clearInterval(interval);
                        return 0;
                    }
                    return current - 1000;
                });
            }, 1000);
        }
        return (currentValue || 0) + 1;
    });
  
    vote({
        trackId: trackId,
        groupId: groupId,
        voterId: voterId,
    }, function(err) {
        if(!err) {
            res.status(200).json({
                msg: '200 OK',
            });
        } else {
            res.status(500).send(err);
        }
    });
};

/**
 * Adds a track to a the playlist that belongs to a given group.
 */
exports.add_leader_to_playlist = function(req, res) {
    var groupId = req.body.group_id;
    var groupRef = firebaseRef.child('groups').child(groupId);
    groupRef.once('value', function(snapshot) {
        var group = snapshot.val();
        
        // First, we determine which track was the winner
        var winningTrack = undefined;
        var winningTrackKey = undefined;
        var winningTrackNumVotes = -1;
        for(var key in group.voting_tracks) {
            var numVotes = group.voting_tracks[key].num_votes || 0;
            if(numVotes > winningTrackNumVotes) {
                winningTrack = group.voting_tracks[key];
                winningTrackKey = key;
                winningTrackNumVotes = numVotes;
            }
        }
        
        if(!winningTrackKey) {
            res.status(404).send('No winning track found');
            return;
        }
        // Now we'll remove that track from the voting tracks
        groupRef.child('voting_tracks').child(winningTrackKey).remove(function(err) {
            if(err) {
                res.status(500).json({err: err});
                return;
            }
            
            var userId = group.owner_id,
                playlistId = group.playlist_id,
                trackUri = winningTrack.uri,
                accessToken = req.session.access_token;
            
            spotify.add_track_to_playlist(
                userId, playlistId, trackUri, accessToken,
                function(err, response, body) {
                    if(err) {
                        console.log('couldn\'t add track to playlist', err);
                        res.status(500).json({err: err});
                    } else {
                        console.log('Adding track...');
                        var msg = 'added track ' + trackUri + ' to playlist ' + playlistId
                        res.status(200).json({msg: msg});
                    }
            });
        });
    });
};

/**
 * Assigns a vote to a track from the specified user
 * 
 * @param {object} params A hash that should contain groupId, trackId, and voterId
 *                        Optional parameters:
 *                            boolean ignorePast Vote even if the user has
 *                                                already voted for this track
 *                            Number numVotes number of votes to add
             
 * @param {Function} [callback] Callback passed as the onComplete parameter to a call to Firebase.transaction()
 */
var vote = function(params, callback) {
    var groupId = params.groupId,
        trackId = params.trackId,
        voterId = params.voterId;
    
    var trackRef = firebaseRef.child('groups').child(groupId)
            .child('voting_tracks').child(trackId),
        voterRef = trackRef.child('voter_ids').child(voterId);
    
    voterRef.once('value', function(snapshot) {
        var val = snapshot.val();
        if(!val || params.ignorePast) {
            // If the user hasn't voted for this track already, then
            // add the user to the list of voters and increment its
            // number of votes
            voterRef.set(true);
            var numVotesRef = trackRef.child('num_votes');
            numVotesRef.transaction(function(currentValue) {
                return (currentValue || 0) + (params.numVotes || 1);
            }, callback, false);
        } else {
            // If the user's already voted for this track, pass an
            // error to the callback
            callback('user ' + voterId + ' already voted for track ' + trackId, 403);
        }
    });
};

exports.vote = function(req, res) {
    vote({groupId: req.body.group_id,
          trackId: req.body.track_id,
          voterId: req.session.user_id}, function(err, statusCode) {
        if(err) {
            console.log('error voting for track', req.body.track_id, err);
            res.status(500, statusCode || 500).json({err: err, msg: err});
        } else {
            res.status(200).json({msg: 'user ' + req.body.user_id + 
                                       ' for ' + req.body.track_id});
        }
    });
};