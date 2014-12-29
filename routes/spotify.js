var querystring = require('querystring');
var request     = require('request');

var clientId     = 'dd954dc18db547cfb93af5f71da7936f';
var clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
var redirectUri  = 'http://localhost:5000/auth';

var stateKey = 'spotify_auth_state';

/**
 * Called when it's time to actually log the user into Spotify. Redirects
 * to Spotify's authorize endpoint, which then redirects to the auth callback
 */
exports.login = function(req, res) {
    var state = generateRandomString(16);
    res.cookie(stateKey, state);
    
    var scope = 'user-read-private user-read-email ' +
                'playlist-modify-public playlist-modify-private';
    res.redirect('https://accounts.spotify.com/authorize?' +
        querystring.stringify({
            response_type: 'code',
            client_id: clientId,
            scope: scope,
            redirect_uri: redirectUri,
            state: state,
        }));
};

/**
 * Authenticates the user. Check's against stored browser
 * state cookie and sends final post request to Spotify's
 * profile endpoint
 */
exports.auth = function(req, res) {
    var code = req.query.code || null;
    var state = req.query.state || null;
    var storedState = req.cookies ? req.cookies[stateKey] : null;
    
    if(state === null || state !== storedState) {
        res.send(req.cookies + ' bad state ' + state + ' ' + storedState);
    } else {
        res.clearCookie(stateKey);
        var authOptions = {
            url: 'https://accounts.spotify.com/api/token',
            form: {
                code: code,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            },
            headers: {
                'Authorization': 'Basic ' + (new Buffer(clientId + ':' +
                                                        clientSecret).toString('base64'))
            },
            json: true,
        };
    
        // authorize with a post request to the Spotify profile
        // endpoint
        request.post(authOptions, function(err, response, body) {
            if(!err && res.statusCode === 200) {
                
                var accessToken = body.access_token,
                    refreshToken = body.refresh_token;

                req.session.access_token = accessToken;
                req.session.refresh_token = refreshToken;
                get_user_info({access_token: accessToken},
                                   function(err, response, body) {
                    if(!err && response.statusCode === 200) {
                        req.session.user_id = body.id;
                        console.log('authentication user ', req.session.user_id);
                        res.redirect('/');
                    } else {
                        res.send(500, err, response.statusCode);
                    }
                });
            } else {
                res.send('bad ' + err + ' ' + res.statusCode);
            }
        });
    }
};

/**
 * Sends a new access token to the caller. Must be passed
 * a valid refresh token `refresh_token`
 */
var refreshToken = function(params, callback) {
    var authOptions = {
        url: 'https://accounts.spotify.com/api/token',
        headers: {'Authorization': 'Basic ' + 
                                      (new Buffer(clientId + ':' + clientSecret)
                                         .toString('base64'))},
        form: {
            grant_type: 'refresh_token',
            refresh_token: params.refresh_token,
        },
        
        json: true,
    }
    
    request.post(authOptions, function(err, response, body) {
        if(!err && response.statusCode === 200) {
            var accessToken = body.access_token;
            callback(err, accessToken);
        } else {
            console.log('bad', response.statusCode, err, authOptions);
            callback(err, undefined);
        }
    });
};

exports.refreshToken = refreshToken;

/**
 * Passes user info to callback based on access_token passed
 * in params
 * 
 */
var get_user_info = function(params, callback) {
    var options = {
        url: 'https://api.spotify.com/v1/me',
        headers: { Authorization: 'Bearer ' + params.access_token},
        json: true,
    };
    request.get(options, callback);
};

exports.get_user_info = get_user_info;

/**
 * function create_playlist({user_id, name, public, access_token}, callback)
 *
 * Wraps around a call to Spotify's playlist creation API
 * 
 * params is a hash that wraps around 'user_id', 'name', 'public',
 *        and 'access_token'
 *
 * callback is the callback passed to the request.post function
 *          when the post is made.it is passed err, response,
 *          and body
 */
exports.create_playlist = function(params, callback) {
    var options = {
        url: 'https://api.spotify.com/v1/users/' + params.user_id + '/playlists',
        form: JSON.stringify({
            name: params.name,
            public: params.public,
        }),
        headers: {
            'Authorization': 'Bearer ' + params.access_token,
        },
    };
    request.post(options, callback);
};

/**
 * function create_playlist({user_id, name, public, access_token}, callback)
 *
 * Wraps around a call to Spotify's search API
 * 
 * params is a hash that wraps around 'q', 'type', 'limit', 'offset',
 *        'req', and 'access_token'
 *
 * callback is the callback passed to the request.get function
 *          when the request is made.it is passed err, response,
 *          and body
 */
var search = function(params, callback) {
    var options = {
        url: 'https://api.spotify.com/v1/search',
        qs: {
            q: params.q,
            type: params.type     || 'album,artist,track',
            limit: params.limit   || 20,
            offset: params.offset || 0,
        },
        headers: {
            'Authorization': 'Bearer ' + params.access_token,
        },
    };
    request.get(options, function(err, response, body) {
        // if the response code is 401, we can try refreshing the
        // access token
        if(response && response.statusCode === 401 &&
           !params.req.session.failedTokenRefresh) {
            params.req.session.failedTokenRefresh = true;
            refreshToken({
                req: params.req,
                refresh_token: params.req.session.refresh_token
            }, function(err, access_token) {
                if(!err) {
                    console.log('old token', params.access_token);
                    console.log('new token', access_token);
                    
                    params.access_token = access_token;
                    search(params, callback);
                }
            });
        } else {
            delete params.req.session.failedTokenRefresh;
            callback(err, response, body);
        }
    });
};

exports.search = search;

/**
 * Adds a track to a Spotify playlist
 *
 * @param string userId
 * @param string playlistId
 * @param string trackId
 * @param string accessToken
 * @param function [callback]
 */
exports.add_track_to_playlist = function(userId, playlistId, trackId, accessToken, callback) {
    var options = {
        url: 'https://api.spotify.com/v1/users/' + userId + '/playlists/' +
             playlistId + '/tracks?uris=' + trackId,
        headers: {
            'Authorization': 'Bearer ' + accessToken,
        },
    };
    request.post(options, callback);
};

/**
 * Generates a random string containing numbers and letters
 * @param  {number} length The length of the string
 * @return {string} The generated string
 */
var generateRandomString = function(length) {
    var text = '';
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (var i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};