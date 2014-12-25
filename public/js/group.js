$(document).ready(function() {
    // Start off with a get request for the current
    // user's user ID
    var userId = undefined;
    $.ajax({
        type: 'GET',
        url: '/get_user_id',
    }).done(function(response) {
        userId = response.user_id;
    });
    
    var groupId = $('.group[group-id]').attr('group-id');
    /* page switching */
    var switching = false;
    $('.window-select .button').click(function(e) {
        e.preventDefault();
        
        // Prevent clicks when we're in the middle of a switch
        if(switching) return;
        switching = true;
        
        // Just quit if the user clicks on a button that's already active
        if($(this).hasClass('active')) {
            return;
        }
        
        // Get button that was previously selected, make it inactive,
        // make the button that's been clicked active, and slide the
        // pointer underneath it
        var oldButton = $('.window-select .active.button');
        var left = parseInt($(this).offset().left);
        oldButton.removeClass('active');
        $(this).addClass('active');
        var pointer = $('.window-select .pointer');
        pointer.css({  // slide pointer under proper button
            left: left + 
                   ($(this).outerWidth() - pointer.outerWidth())/2,
        });
        
        
        // Determine which direction to slide the new window to
        var oldLeft = parseInt(oldButton.offset().left);
        var dir = left < oldLeft ? 'left' : 'right';
        
        var forSection = $(this).attr('for');
        var section = $('section.' + forSection);
        var currentSection = $('section.active');
        
        var afterSlideOut = function() {
            // remove the animation class to prevent the slide out animation
            // from running when this section's re-rendered
            $(this).removeClass('slide-out-' + dir).hide();
            util.removePrefixedEventListener(this, 'AnimationEnd', afterSlideOut);
        };
        
        // Hide any icons so we can render them post-width calculations instead of
        // in the middle of them when they're being loaded
        var icons = section.find('.icon').hide();
        var afterSlideIn = function() {
            // remove the animation class to prevent the slide in animation
            // from running when the section's re-rendered
            $(this).removeClass('slide-in-' + dir);
            util.removePrefixedEventListener(this, 'AnimationEnd', afterSlideIn);
            
            // 
            icons.show(200);
            // reset switching to false after we finish sliding in the
            // new window
            switching = false;
        }
        
        util.addPrefixedEventListener(currentSection[0], 'AnimationEnd', afterSlideOut);
        util.addPrefixedEventListener(section[0], 'AnimationEnd', afterSlideIn);
        
        currentSection
            .removeClass('active')
            .addClass('slide-out-' + dir);
        section
            .addClass('active')
            .addClass('slide-in-' + dir).show();
    });
    
    /* listening */
    
    /* adding */
    var loadedTracks = {};
    var groupFns = {
        /**
         * Submits a vote for the track whose button was clicked
         *
         * @param MouseEvent e The mouse event fired by the click
         */
        submitForVotingClickFn: function(e) {
            var trackElem = $(this).parents('.track');
            var trackId = trackElem.attr('track-id');
            var groupId  = $(this).parents('.group.content').attr('group-id');
            $(this).addClass('loading');
            var that = this;
            $.ajax({
                type: 'POST',
                url: '/add_track_for_voting',
                data: {
                    track: JSON.stringify(loadedTracks[trackId]),
                    group_id: groupId,
                },
            }).done(function(response) {
                $(that).removeClass('loading');
                groupFns.submitForVotingAnimationFn(trackElem, function() {
                    $('.window-select .vote.button').click();
                });
            });
            e.preventDefault();
        },
        
        /**
         * Runs an animation on the passed in element. Should be called
         * on a voting object when it's vote function is triggered
         * successfully
         *
         * @param HtmlElement elem The element to run the animation on. Should
         *                         be run on a voting object element
         * @param function [callback] Called after the animation is completed.
         */
        submitForVotingAnimationFn: function(elem, callback) {
            elem = $(elem);
            
            var inner = elem.find('.inner'),
                image = inner.find('.icon');
            
            image.velocity({
                marginTop: '25%',
            }, {
                duration: 400,
            }).velocity({
                marginTop: '-280%',
                opacity: 0.4,
            }, {
                delay: 200,
                duration: 400,
                complete: callback
            });
        },
        
        /**
         * Sets a transition on the window's background image and animates
         * a shift from whatever it is now to the background image attribute
         * that's passed in
         *
         * @param string backgroundImage The background-image value to set the background to
         */
        setBackground: function(backgroundImage) {
            var backgroundElem = $('.group.swap-page > .background')
            var setBackground = function() {
                util.removePrefixedEventListener(
                    backgroundElem[0], 'TransitionEnd', setBackground);
                backgroundElem.css({
                    backgroundImage: backgroundImage,
                    opacity: 1,
                });
            };
            util.addPrefixedEventListener(backgroundElem[0], 'TransitionEnd', setBackground);
            backgroundElem.css('opacity', 0);
        },
        
        /**
         * Resets transforms on passed in element added by pan and swipe
         * functions
         *
         * @param hammerEvent Hammer event object
         * @param HtmlElem elem Element to reset
         */
        resetSearchResultPosition: function(hammerEvent, elem) {
            // We prevent reset calls from being made in rapid succession
            // For example, when a pan across the threshold leads quickly
            // into a swipe event past the boundry, it can be hard to prevent
            // the reset from being called twice
            var time = new Date();
            if(groupFns.private.lastReset &&
               time - groupFns.private.lastReset < 400) {
                return;
            }
            groupFns.private.lastReset = time;
            
            elem = $(elem);
            // Is 1 if the event is toward the right and -1 otherwise
            var directionScalar = hammerEvent.deltaX > 0 ? 1 : -1;
            if(groupFns.private.swipeLocation) {
                // send to the location it was last at before animating
                // the next translation
                elem.velocity(
                    groupFns.private.swipeLocation, {
                        duration: 0,
                    }
                );
            }
            
            // Animate the bounce back to the album artwork's original
            // position
            elem.velocity({
                translateZ: '0',
                translateX: (-directionScalar * 11) + 'px',
                translateY: '2px',
                rotateZ: (-directionScalar * 2) + 'deg',
                opacity: 1,
            }, {
                easing: 'spring',
            }).velocity({
                translateX: '0px',
                translateY: '0px',
                rotateZ: '0deg'
            }, {
                easing: 'spring',
            });
        },
        
        /**
         * Transforms an element as it's being panned to animate it's motion
         * and slides into the next search result if the element moves past
         * an internally defined threshold
         *
         * @param hammerEvent Hammer event object passed to pan function
         * @param HtmlElement elem Element to slide around
         */
        panSearchResult: function(hammerEvent, elem) {
            elem = $(elem);
            var threshold = window.innerWidth / 2.5;
            
            // If the user stops here, we can either get rid of our
            // transformations or, if we've reached our threshold,
            // swipe into the next element
            if(hammerEvent.isFinal) {
                if(Math.abs(hammerEvent.deltaX) >= threshold) {
                    groupFns.swipeSearchResult(hammerEvent, elem);
                } else {
                    groupFns.resetSearchResultPosition(hammerEvent, elem);
                }
            } else {
                var rotation = 11 * hammerEvent.deltaX/threshold,
                    translateY = Math.abs(rotation),
                    opacity = 1 - Math.abs((hammerEvent.deltaX/threshold)/8);
                
                // Set the transforms on the album artwork
                var transform = 'translateX(' + hammerEvent.deltaX + 'px) ' +
                                'translateY(' +  translateY + 'px) ' +
                                'rotate(' + rotation + 'deg)';
                util.setPrefixedStyle(elem[0], 'transform', transform);
                elem[0].style.opacity = opacity;
                
                // Update the current swipe location
                groupFns.private.swipeLocation = {
                    translateX: hammerEvent.deltaX,
                    translateY: translateY,
                    rotateZ: rotation,
                    opacity: opacity,
                };
            }
        },
        
        private: {
            swiping: false,
            swipeLocation: undefined,
            lastSwipe: undefined,
            lastReset: undefined,
        },
        
        /**
         * Moves the passed in artwork element to the left and brings in
         * the next search result's card and artwork
         *
         * @param hammerEvent Hammer event object passed to swipe or pan
         *                    function
         * @param HtmlElement artworkElem Artwork element for the swiped search
         *                                result
         */
        swipeSearchResult: function(hammerEvent, artworkElem) {
            // TODO: maybe queue up swipes
            if(groupFns.private.swiping) {
                return;
            }
            
            // If this isn't a final event, then there's not really any
            // reason to fulfill this--the threshold check will send us
            // back here anyway
            if(!hammerEvent.isFinal) {
                return;
            }
            
            artworkElem = $(artworkElem);
            // Is 1 if the event was toward the right and -1 otherwise
            var directionScalar = hammerEvent.deltaX > 0 ? 1 : -1,
                elemInner = artworkElem.parents('.inner'),
                slideOrder = artworkElem.attr('slide-order'),
                elemSpotifyObject = elemInner.parents('.spotify-object'),
                nextSlideOrder = parseInt(slideOrder) + (-directionScalar),
                nextArtworkElem = $('.inner .icon[slide-order="' + nextSlideOrder + '"');
            
            // Record the last swipe here to prevent the swipe of the same
            // search result from being called to soon after the last time
            // it was called
            if(groupFns.private.lastSwipe) {
                if(groupFns.private.lastSwipe.slideOrder === slideOrder &&
                   new Date() - groupFns.private.lastSwipe.time < 400) {
                    return;
                }
            }
            groupFns.private.lastSwipe = {
                time: new Date(),
                slideOrder: slideOrder,
            };
            
            // Make note of the fact that the swipe event is currently
            // being handled
            groupFns.private.swiping = true;
            
            // In case we're trying to slide past the last search result
            if(nextArtworkElem.length === 0) {
                groupFns.resetSearchResultPosition(hammerEvent, artworkElem);
                groupFns.private.swiping = false;
                return;
            }
            
            var nextElemInner = nextArtworkElem.parents('.inner'),
                nextElemSpotifyObject = nextElemInner.parents('.spotify-object');
            
            // First, if we're moving off of a swipe, we'll need to set the
            // artwork's initial position to the position it was swiped to
            if(groupFns.private.swipeLocation) {
                artworkElem.velocity(groupFns.private.swipeLocation, {
                    duration: 0,
                });
            }
            
            // Animating the artwork
            artworkElem.velocity({
                translateX: (directionScalar * window.innerWidth) + 'px',
                translateY: '11px',
                rotateZ: (directionScalar * 11) + 'deg',
                opacity: 0,
            });
            
            // Called when it's time to show the next element
            var showNextElement = function() {
                nextElemSpotifyObject.show();
                // Animate the next element's copy
                nextElemInner.find('.copy').velocity({
                    opacity: 1,
                });
                
                // Before the element is displayed, we'll start transitioning
                // into the new background artwork and to the next track
                // indicator
                groupFns.setBackground(nextArtworkElem.css('background-image'));
                groupFns.setTrackNumDisplay(nextSlideOrder);
                
                // And animate the next element's album artwork
                nextArtworkElem.velocity({
                    translateX: '0px',
                    translateY: '0px',
                    rotateZ: '0deg',
                    opacity: 1,
                }, {
                    delay: 200,
                    easing: 'spring',
                    duration: 200,
                    complete: function() {
                        // done swiping
                        groupFns.private.swiping = false;
                    },
                });
            };
            
            // Now we'll animate the inner element's content. We'll fade out the copy
            // and slide it up before quickly replacing it with the other card
            
            // Start by prepping the next element's card
            // Set the transform property on its album artwork
            var transform = 'translateX(' + (-directionScalar * window.innerWidth/2) + 'px) ' +
                            'translateY(11px) ' + 
                            'rotate(' + (-directionScalar * 11) + 'deg)';
            util.setPrefixedStyle(nextArtworkElem[0], 'transform', transform);
            
            // Hide its copy
            nextElemInner.find('.copy').css({
                opacity: 0,
            });
            
            // Then animate the current element's card, hide it,
            // and show the next card
            elemInner.find('.copy').velocity({
                opacity: 0
            }, {
                complete: function() {
                    elemSpotifyObject.hide();
                    showNextElement();
                },
            });
        },
      
        setTrackNumDisplay: function(slideOrder) {
            var trackIndicators = $('.track-indicators');
            trackIndicators.find('.active').removeClass('active');
            trackIndicators.find(
                '.track-indicator[slide-order="' + slideOrder + '"]'
            ).addClass('active');
            
            $('.track-num').text(parseInt(slideOrder) + 1);
        },
    };

    /**
     * Makes the AJAX call for spotify search results and renders them
     * when they're received.
     */
    var previousSearch = '';
    $('#search').keyup(function(e) {
        var query = $(this).val();
        if(query === '') {
            $('.search-results').html('');
            return;
        } else if(query === previousSearch) {
            return;
        }
        
        previousSearch = query;
        var loadingIcon = $('.add .loading-icon').show(),
            searchResultsWrapper = $('#search-results').hide(),
            that = this;
        
        setTimeout(function() {
            // If the query's changed in the time between when it was typed
            // and now, don't bother sending the request
            if(query !== $(that).val()) {
                return;
            }
            
            $.ajax({
                type: 'GET',
                url: '/search',
                data: {
                    q: query,
                    html: true,
                    json: true,
                },
            }).done(function(result) {
                // If these aren't results for the query that's
                // currently being searched for, exit here
                if($(that).val() !== result.q) {return;}

                // TODO: render no results message when nothing is found
                if(result.length === 0) {
                    return;
                }

                var html = result.html,
                    addTrackButtonHtml = '' +
                      '<div class="add-track-button">' +
                        '<span>add</span>' +
                      '</div>' +
                      '<div class="clear"></div>';

                // Hide the loading indicators once we've rendered
                // the result
                loadingIcon.hide();
                searchResultsWrapper.html(html).show();

                var trackElems = searchResultsWrapper.find('.track');

                // Make the first search result visible
                var firstResultElem = trackElems.first().addClass('active');

                // Set the background to this element's background
                // image
                var backgroundImage = firstResultElem.find('.inner .icon')
                        .css('background-image');
                groupFns.setBackground(backgroundImage);

                var innerTrackElems = trackElems
                    .find('.inner');
              
                // Set the height on the artwork so that it forms a
                // square
                innerTrackElems
                    .find('.icon')
                    .css('height', innerTrackElems.find('.icon').width())
                    .each(function(i) {
                    var elem = $(this).attr('slide-order', i);
                    var hammer = new Hammer(elem[0]);
                    
                    hammer.on('swipe', function(event) {
                        groupFns.swipeSearchResult(event, elem);
                    });
                    
                    hammer.on('pan', function(event) {
                        groupFns.panSearchResult(event, elem);
                    });
                    
                    elem.on('mousedown', function(e) {
                        e.preventDefault();
                    });
                });
                
                $(addTrackButtonHtml)
                    .click(groupFns.submitForVotingClickFn)
                    .appendTo(innerTrackElems)

                // Add track slide indicators
                var trackIndicatorHtml = '<div class="track-indicator"></div>';
                var trackIndicatorWrapperElem = $('.track-indicators');
                for(var i = 0; i < trackElems.length; i++) {
                    $(trackIndicatorHtml)
                        .attr('slide-order', i)
                        .appendTo(trackIndicatorWrapperElem);
                }
              
                var firstResultSlideOrder = firstResultElem.find('.inner .icon').attr('slide-order');
                groupFns.setTrackNumDisplay(firstResultSlideOrder);
                
                // Update the displayed number of results
                $('.search-results .num-tracks').text(trackElems.length);
                
                var tracks = result.tracks.items;
                for(var i = 0; i < tracks.length; i++) {
                    var id = tracks[i].id;
                    loadedTracks[id] = tracks[i];
                }
            });
        }, 800);
    });
    
    /* voting */
    var numTotalVotes = 0,
        firebase = new Firebase('https://blinding-fire-3652.firebaseio.com/'),
        groupRef = firebase.child('groups').child(groupId),
        tracksRef = groupRef.child('voting_tracks');
    
    tracksRef.on('child_added', function(snapshot) {
        // add to numTotalVotes
        var val = snapshot.val();
        // quit if some child besides the track hash was added
        if(typeof(val) !== 'object') {return;}
        
        numTotalVotes += val.num_votes;
        // hide loading wheel if it's up
        $('.vote-wrapper .loading-icon').hide();
        // send a get request to render a voting-object for this track
        $.ajax({
            type: 'GET',
            url: '/render_voting_track',
            data: {json: JSON.stringify(val)},
        }).done(function(responseHtml) {
            var votingElem = $(responseHtml);
            votingElem.prependTo($('.voting-list'))
                .find('.vote-button').click(groupFns.votingButtonClickFn);
            groupFns.adjustVoteIndicators();
            groupFns.moveVotingObjects();
        });
    });
    
    tracksRef.on('child_changed', function(snapshot, prevSnapshot) {
        var val = snapshot.val(),
            numVotes = val.num_votes,
            trackId = val.id,
            trackElem = $('.track[track-id="' + trackId + '"]'),
            numVotesElem = trackElem.find('.num-votes');
        
        // Called immediately if everything can be found okay. Otherwise,
        // it's only called once the num-votes element has been loaded
        var setUpVoteElems = function() {
            var oldNumVotes = numVotesElem.text();
            numVotesElem.text(numVotes);
            numTotalVotes += (numVotes - oldNumVotes);
            groupFns.adjustVoteIndicators();
            groupFns.moveVotingObjects(true);
            
            // If the vote got added after the element was already
            // rendered, go ahead and make the vote button active
            if(val.voter_ids[userId]) {
                trackElem.find('.vote-button').addClass('active');
            }
        };
        
        // If the num-votes element couldn't be found, it's likely that it just
        // hasn't been added to the DOM by the time the child_changed handler
        // is called. We set an interval here that checks repeatedly for the DOM
        // element until it's loaded
        if(numVotesElem.length === 0) {
            var interval = setInterval(function() {
                trackElem = $('.track[track-id="' + trackId + '"]');
                numVotesElem = trackElem.find('.num-votes');
                if(numVotesElem.length === 0) {return;}
                clearInterval(interval);
                setUpVoteElems();
            }, 200);
            
            // We'll also set a timeout on this check of twenty seconds, just
            // in case the element can't be found for some other reason
            setTimeout(function() {
                clearInterval(interval);
            }, 20000);
        } else {
            setUpVoteElems();
        }
    });
    
    groupFns.votingButtonClickFn = function(e) {
        e.preventDefault();
        var trackId = $(this).parents('.track').attr('track-id');
        var that = this;
        $.ajax({
            type: 'POST',
            url: '/vote',
            data: {
                track_id: trackId,
                group_id: groupId,
            },
        }).done(function(response) {
            if(!response.err) {
                $(that).addClass('active');
            }
        });
    };
    
    // notification fades in and bounces up to center of screen, then
    // exits to the top and fades out
    groupFns.voteAnimationFn = function(elem) {
        
    };
    
    groupFns.adjustVoteIndicators = function() {
        $('.voting-object').each(function(i) {
            var numVotesElem = $(this).find('.num-votes');
            var numVotes = numVotesElem.text();
            $(this).find('.votes-indicator .bar').css({
                width: ((numVotes/numTotalVotes) * 100) + '%',
            });
        });
    };
    
    var moveVotingObjectsQueue = [],
        moveVotingObjectsInterval = undefined,
        moveVotingObjectsCurrentTask = undefined;
    /**
     * Moves voting objects to their proper positions
     * 
     * @param boolean [animate] Set this to true if the movement should be
     *                          animated. Defaults to false.
     */
    groupFns.moveVotingObjects = function(animate) {
        // increment moveVotingObjectsLastTaskAdded and add it to the
        // queue of tasks to be completed
        moveVotingObjectsQueue.push('task');
        if(moveVotingObjectsInterval === undefined) {
            moveVotingObjectsInterval = setInterval(function() {
                if(moveVotingObjectsQueue.length === 0) {
                    clearInterval(moveVotingObjectsInterval);
                    moveVotingObjectsInterval = undefined;
                } else {
                    if(moveVotingObjectsCurrentTask === undefined) {
                        moveVotingObjectsCurrentTask = moveVotingObjectsQueue.shift();
                        groupFns.moveVotingObjectsHelper(animate);
                    }
                }
            }, 200);
        }
    };
    
    groupFns.moveVotingObjectsHelper = function(animate) {
        if(animate !== true) {animate = false};
        
        /**
         * Helper function that gets the number of votes from a
         * voting object element
         * 
         * @param elem The voting object element to get the number of votes from
         * @returns Number The number of votes the voting object has recorded
         */
        var getNumVotes = function(elem) {
            return parseInt($(elem).find('.num-votes').text());
        };
        
        /**
         * Helper function that gets the passed in voting object's
         * track ID
         *
         * @param elem The voting object element to get a track ID from
         * @returns string The passed in voting object's track ID
         */
        var getTrackId = function(elem) {
            return $(elem).attr('track-id');
        };
        
        // Start off by assembling a list of voting objects in their current,
        // unsorted order. We absolutely position them at their current location
        // so we can animate their shift later
        var elems = [];
        var totalHeight = 0;
        
        // We'll also store each of the element's unsorted order so we
        // can implement a stable sort
        var startingOrder = {};
        
        // Before we begin, we'll check if the elements are already in sorted order.
        // If they are, we can cut out early
        var lastNumVotes;
        var sorted = true;
        $('.voting-object').each(function(i) {
            var numVotes = getNumVotes($(this));
            if(lastNumVotes === undefined) {
                lastNumVotes = numVotes;
            } else {
                sorted = lastNumVotes >= numVotes;
                if(!sorted) {return false;}
                lastNumVotes = numVotes;
            }
        });
        
        // If the elements are already sorted, we don't need to do anything--
        // just end the task and return.
        if(sorted) {
            $('.winning').removeClass('winning');
            var c = $('.voting-list .voting-object:first-child').addClass('winning');
            moveVotingObjectsCurrentTask = undefined;
            return;
        }
        
        $('.voting-object').each(function(i) {
            elems.push($(this));
            startingOrder[getTrackId(this)] = i;
            
            // We only need to do this absolute positioning if we'll need to
            // animate the elements later on
            if(animate) {
                $(this).css({
                    position: 'absolute',
                    top: totalHeight + 'px',
                });
                totalHeight += $(this).outerHeight(true);
            }
        });
        
        // Now we can sort elems to find its new order
        elems.sort(function(a, b) {
            // if a and b have the same number of votes, use the
            // starting order hash to make sure they stay in the
            // same order they started in
            var aNumVotes = getNumVotes(a),
                bNumVotes = getNumVotes(b);
            if(aNumVotes === bNumVotes) {
                return startingOrder[getTrackId(a)] - startingOrder[getTrackId(b)];
            } else {
                // subtract a from b to get descending order
                return bNumVotes - aNumVotes;
            }
        });
        
        // As soon as the final animation finishes, we'll
        // unset our absolute positioning and top changes
        // and quickly reappend the voting objects in their
        // proper order
        var wrapper = elems[0].parent();
        /**
         * Helper function that removes added positioning styles and reappends
         * each of the voting objects in the order given by elems
         */
        var reappendElems = function() {
            if(elems[0]) {
                $('.winning').removeClass('winning');
                elems[0].addClass('winning');
            }
            // Add winning class to the first element before
            // we reappend it
            for(var i = 0; i < elems.length; i++) {
                var elem = elems[i].appendTo(wrapper)
                if(animate) {
                    // We only need to adjust positioning if we changed it
                    // earlier to set up animations
                    elem.css({
                        position: '',
                        top: '',
                    });
                }
            }
        };
        
        if(animate) {
            // Now we'll run the animations. Once they've all finished,
            // we'll call our reappendElems helper and signal that there
            // is no longer any current task

            // keep track of the number of elements that've finished being
            // animated so we know when we've finished
            var numAnimated = 0;
            totalHeight = 0; // reuse totalHeight
            for(var i = 0; i < elems.length; i++) {
                $.when(elems[i].animate({
                    top: totalHeight + 'px',
                })).then(function() {
                    numAnimated++;
                    if(numAnimated === elems.length) {
                        reappendElems();
                        // task completed
                        moveVotingObjectsCurrentTask = undefined;
                    }
                });
                totalHeight += elems[i].outerHeight(true);
            }
        } else {
            // If we don't need to animate anything, just reappend the
            // elements in their new order
            reappendElems();
        }
    };
    
    /* timer */
    var voteWaitTime = 30000;
    groupRef.child('time_left').on('value', function(snapshot) {
        var val = snapshot.val();
        if(val === undefined || val === null) {return;}
        if(val <= 0) {
            $.ajax({
                type: 'POST',
                url: '/add_leader_to_playlist',
                data: {
                    group_id: groupId,
                },
            }).done(function(response) {
                // TODO: signify that the track has been added to the
                //       playlist
            });
        }
        $('.time-indicator .bar').css({
            width: ( ( (voteWaitTime - val) / voteWaitTime ) * 100) + '%',
        });
    });
});