var request  = require('request'),
    crypto   = require('crypto'),
    models   = require('../models.js'),
    Firebase = require('firebase'),
    SpotifyAPI  = require('spotify-web-api-node');

// Milliseconds between voting rounds
var voteWaitTime = 30000;
exports.voteWaitTime = this.voteWaitTime;

var firebaseRef = new Firebase(process.env.FIREBASE_URL);
firebaseRef.authWithCustomToken(process.env.FIREBASE_SECRET, function(err) {
    if(err) {
        console.log('Couldn\'t authenticate', err);
    } else {
        console.log('Authenticated successfully');
    }
});

var spotifyCredentials = {
    clientId:     'dd954dc18db547cfb93af5f71da7936f',
    clientSecret:  process.env.SPOTIFY_CLIENT_SECRET,
    redirectUri:   process.env.NODE_ENV === 'development' ?
        'http://localhost:5000/auth' : 'http://aux.herokuapp.com/auth'
},
    scopes = ['user-read-private', 'user-read-email', 'playlist-modify-public',
              'playlist-modify-private'],
    stateKey = 'spotify_auth_state';

/**
 * Called when it's time to actually log the user into Spotify.
 * Redirects to Spotify's authorize endpoint, which then redirects
 * to the auth callback
 *
 * @param req
 * @param res
 */
exports.login = function(req, res) {
    
    var spotify = new SpotifyAPI(spotifyCredentials);
    var state = _generateRandomString(16);
    
    // store the state so we can check it in the auth endpoint
    res.cookie(stateKey, state);
    var authUrl = spotify.createAuthorizeURL(scopes, state);
    res.redirect(authUrl);
};

/**
 * Authenticates the user. Checks against stored browser
 * state cookie and sends final post request to Spotify's
 * profile endpoint
 *
 * @param req
 * @param res
 */
exports.auth = function(req, res) {
    var state = req.query.state || null;
    var code = req.query.code || null;
    var storedState = req.cookies ? req.cookies[stateKey] : null;
    
    // Check the state
    if(state === null || state !== storedState) {
        res.statusCode(403).send('bad state');
        return;
    }
    
    var spotify = new SpotifyAPI(spotifyCredentials);
    
    spotify.authorizationCodeGrant(code).then(function(data) {
        req.session.access_token = data.access_token;
        req.session.refresh_token = data.refresh_token;
        
        spotify.setAccessToken(data.access_token);
        spotify.setRefreshToken(data.refresh_token);
        
        spotify.getMe().then(function(data) {
            req.session.spotify_id = data.id;
            res.redirect('/');
        }, function(err) {
            console.log('error getting user:', err);
            res.statusCode(500).send('error getting user: ', err);
        });
    }, function(err) {
        console.log('error getting access token:', err);
        res.statusCode(500).send('error getting access token: ' + err);
    });
};

/**
 * Creates a group and stores it in the firebase and its location
 * data on Mongo
 *
 * @param req
 * @param res
 */
exports.create_group = function(req, res) {
    var spotifyId  = req.session.spotify_id;
    var name     = req.body.name;
    var location = req.body.location;
    var pub      = req.body['public'] || false;
    
    var spotify = new SpotifyAPI({
        accessToken: req.session.access_token,
        refreshToken: req.session.refresh_token
    });
    
    spotify.createPlaylist(spotifyId, name, {'public': pub})
        .then(function(playlist) {
            // Store the group with its location on mongo
            models.Group.create({
                user_id: spotifyId,
                name: name,
                latitude: location.latitude,
                longitude: location.longitude
            }, function(err, group) {
                if(err) {
                    console.log('error saving group location', err);
                    res.status(500).send(err);
                    return;
                }
                
                // create the group object to save to firebase
                var firebaseGroup = {
                    spotify_id: spotifyId,
                    playlist_id: playlist.id,
                    access_token: req.session.access_token,
                    refresh_token: req.session.refresh_token
                };

                // store the group object in firebase
                firebaseRef.child('groups').child(group.id).set(firebaseGroup);
                
                // add the group_id field to the object before returning
                // it as json
                res.status(201).json(group);
            });
        }, function(err) {
            console.log('error creating group: ' + err);
            res.sendStatus(500).send('error creating group: ' + err);
        });
};

/**
 * Searches for tracks via the Spotify search api
 *
 * @param req
 *     @param {string} req.query.q
 *     @param {number} req.query.limit
 *     @param {number} req.query.offset
 *     @param {boolean} [req.query.html=false] When this is set to true, the
 *     response JSON will render the html for several search results in its
 *     "html" member
 *     
 * @param res
 */
exports.search = function(req, res) {
    
    var spotify = new SpotifyAPI({
        accessToken: req.session.access_token,
        refreshToken: req.session.refresh_token
    });
    
    var query = req.query.q;
    var limit = req.query.limit || 10;
    var offset = req.query.offset || 0;
    var renderHtml = req.query.html === 'true' ||
                     req.query.html === true;
    
    spotify.searchTracks(query, {limit: limit, offset: offset}).then(function(searchJson) {
        searchJson.q = query;
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
            res.statusCode(200).json(searchJson);
        }
    }, function(err) {
        console.log('error searching with query ', query, ':', err);
        res.statusCode(500).send('error searching with query ' +
                                 query + ': ' + err);
    });
};

/**
 * Called when the song has been added to the playlist or we reach an error
 *
 * @callback addLeaderToPlaylistCallback
 * @param [err]
 */

/**
 * Adds a track to a the playlist that belongs to a given group.
 *
 * @param {string} groupId
 * @param {addLeaderToPlaylistCallback} [onComplete]
 */
var addLeaderToPlaylist = function(groupId, onComplete) {
    
    onComplete = onComplete || function() {return undefined;};
    
    var groupRef = firebaseRef.child('groups').child(groupId);
    groupRef.once('value', function(snapshot) {
        
        // Start by getting the group from Firebase. Then we'll run through
        // its voting tracks to determine which is the winner
        var group = snapshot.val();
        var spotify = new SpotifyAPI({
            accessToken: group.access_token,
            refreshToken: group.refresh_token
        });
        
        var winningTrackNumVotes = -1;
        var winningTrackKey;
        var winningTrack;
        
        for(var key in group.voting_tracks) {
            var numVotes = group.voting_tracks[key].num_votes || 0;
            if(numVotes > winningTrackNumVotes) {
                winningTrack = group.voting_tracks[key];
                winningTrackKey = key;
                winningTrackNumVotes = numVotes;
            }
        }
        if(!winningTrackKey) {
            onComplete('No winning track found');
            return;
        }
        
        // Remove the winner from the group's list of voting tracks
        var votingTracksRef = groupRef.child('voting_tracks');
        votingTracksRef.child(winningTrackKey).remove(function(err) {
            if(err) {
                onComplete(err);
                return;
            }
            
            // Update voting tracks length and, if there are still more tracks
            // left, kick off the next voting round
            var lengthRef = votingTracksRef.child('length');
            lengthRef.once('value', function(snapshot) {
                // If there are still tracks left to vote on, then move on to
                // the next voting round
                if(snapshot.val() > 1) {
                    startNextRound(groupId);
                }
                
                // Set off a transaction to decrement the length
                lengthRef.transaction(function(currentLength) {
                    currentLength--;
                    return currentLength;
                });
            });
            
            // Add the track to the group's playlist
            spotify.addTracksToPlaylist(
                group.spotify_id, group.playlist_id, winningTrack.uri
            ).then(function(data) {
                console.log('added track', winningTrack.uri, 'to playlist',
                            group.playlist_id);
                onComplete();
            }, function(err) {
                console.log('there was an error adding', winningTrack.uri,
                            'to playlist', group.playlist_id, ':', err);
                onComplete(err);
            });
        });
    });
};

/**
 * Responds with a JSON object containing the requester's user id
 *
 * @param req
 * @param res
 */
exports.get_user_id = function(req, res) {
    res.status(200).json({user_id: req.session.user_id});
};

/**
 * Renders the group creation page
 *
 * @param req
 * @param res
 */
exports.create = function(req, res) {
    res.status(200).render('create');
};

/**
 * Renders the index page
 * @param req
 *     @param {string} [req.query.layout=true] Pass false as a query parameter
 *     if the template should be rendered without a layout
 * @param res
 */
exports.index = function(req, res) {
    
    var layout = req.query.layout !== false;
    
    if(layout === false) {
        res.status(200).render('index', {layout: false});
    } else {
        res.status(200).render('index');
    }
};

/**
 * Renders find nearby groups page
 *
 * @param req
 *     @param {string} [req.query.layout=true] Pass false as a query parameter
 *     if the template should be rendered without a layout
 * @param res
 */
exports.find = function(req, res) {
    var layout = req.query.layout !== 'false' &&
                 req.query.layout !== false;
    if(layout === false) {
        res.status(200).render('find', {layout: false});
    } else {
        res.status(200).render('find');
    }
}

/**
 * Generates a user id based on a given group id
 *
 * @param {string} group_id
 * @returns {string}
 */
var generateUserId = function(group_id) {
    return crypto.createHash('md5').update(group_id + new Date()).digest('hex');
}

/**
 * Renders a group page
 *
 * @param req
 *     @param {string} [req.query.layout=true] Pass false as a query parameter
 *     if the template should be rendered without a layout
 * @param res
 */
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
                    
                    // spotify ID of the owner of the playlist
                    req.session.spotify_id = groupData.spotify_id;
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
 *
 * @param req
 *     @param {string} req.query.json
 * @param res
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
 * Finds groups near the specified location
 * 
 * @param req
 * @param res
 */
exports.find_nearby_groups = function(req, res) {
    var renderHtml = req.query.html === 'true' ||
                     req.query.html === true;
    
    var latitude  = Number(req.query.latitude);
    var longitude = Number(req.query.longitude);
    
    var distance = Number(req.query.distance || 1000); // default to 1,000 m
    var sendData = function(err, data) {
        if(err) {
            console.log('error finding groups', err);
            res.status(500).send(err);
            return;
        }
        if(renderHtml) {
            res.render('partials/group-list', {
                layout: false,
                groups: data
            });
        } else {
            res.status(200).json(data);
        }
    };
    
    models.Group
        .where('longitude').gte(longitude - distance).lte(longitude + distance)
        .where('latitude').gte(latitude - distance).lte(latitude + distance)
        .exec(sendData);
};

/**
 * Starts a new round for the passed in group
 *
 * @param {string} groupId
 */
var startNextRound = function(groupId) {
    var groupRef = firebaseRef.child('groups').child(groupId);
    var timeLeftRef = groupRef.child('time_left');
    var roundNumRef = groupRef.child('round_num');
    
    roundNumRef.transaction(function(currentRoundNum) {
        return (currentRoundNum || 0) + 1;
    });
    
    var interval = setInterval(function() {
        timeLeftRef.transaction(function(currentTime) {
            if(!currentTime) {
                // If the timer isn't set, set it
                return voteWaitTime;
            } else if(currentTime <= 1000) {
                // If we're about to run the timer down, stop, and add the
                // leader to the playlist
                clearInterval(interval);
                addLeaderToPlaylist(groupId);
                
                // time's up, return 0
                return 0;
            } else {
                // Otherwise, update the timer
                return currentTime - 1000;
            }
        });
    }, 1000);
};

/**
 * Adds a track to a specified group's voting tracks and, if the track was
 * previously empty, kicks off the group's voting timer
 *
 * @param req
 *     @param {string} req.body.track A JSON encoded string representing a
 *     Spotify track
 * @param res
 */
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
    var lengthRef = votingTracksRef.child('length');
    lengthRef.once('value', function(snapshot) {
        // if the length is either 0 or undefined, go ahead and start
        // the timer
        if(!snapshot.val()) {
            startNextRound(groupId);
        }
        lengthRef.transaction(function(currentValue) {
            return (currentValue || 0) + 1;
        });
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
 * Assigns a vote to a track from the specified user
 * 
 * @param {object} params A hash that should contain groupId, trackId, and
 * voterId
 *     @param {string} params.groupId
 *     @param {string} params.trackId
 *     @param {string} params.voterId
 *     @param {boolean} [params.ignorePast] Vote even if the user has already
 *     voted for this track
 *     @param {Number} [params.numVotes] number of votes to add
 * @param {function} [callback] Callback passed as the onComplete parameter
 * to a call to Firebase.transaction()
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

/**
 * Adds a vote to a given track
 *
 * @param req
 *     @param {string} req.body.group_id
 *     @param {string} req.body.track_id
 *     @param {string} req.session.user_id
 * @param res
 */
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

/**
 * Generates a random string containing numbers and letters
 *
 * @param  {number} length The length of the string
 * @returns {string} The generated string
 */
var _generateRandomString = function(length) {
    var text = '';
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' +
                   '0123456789';
    for (var i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};
