$(document).ready(function() {
    /**
     *
     */
    var Swapper = function(attach_selector, base_url, loaded_selector) {
        // array of loaded pages
        this.loaded = [];
        this.current = undefined;
        
        if(loaded_selector) {
            this.current = $(loaded_selector);
            this.addToLoaded(window.location.href, this.current);
        }
        
        this.baseUrl = base_url || '';
        this.attachElem = $(attach_selector);
        
        var that = this;
        window.addEventListener('popstate', function(e) {
            that.back();
        });
    };

    Swapper.prototype.addToLoaded = function(url, elem) {
        this.loaded.push({
            url: url,
            elem: elem,
        });
    };

    /**
     * Slides the page given by href into view
     *
     * callback called after the page is loaded and placed. passed
     * true if the page was loaded successfully and false
     * if there was an error loading the page
     */
    Swapper.prototype.slideIn = function(href, callback) {
        var that = this;
        $.ajax({
            type: 'GET',
            url: this.baseUrl + href,
            data: {layout: false},  // add the layout: false parameter
            cache: false
        }).done(function(html) {
            
            var elem = $(html).hide();
            that.addToLoaded(href, elem);
            
            var winWidth = window.innerWidth;
            if(that.current) {
                var e = that.current;
                e.css('position', 'absolute');
                e.animate({
                    left: -winWidth + 'px',
                }, 800, function() {
                    e.remove();
                });
            }
            
            var newElem = elem.appendTo(that.attachElem);
            newElem.css('left', winWidth + 'px').show();
            that._setPrefixedStyle(newElem[0], 'Transition', 'left 0.8s');
            newElem.css({
                position: 'absolute',
                left: 0,
            });
            
            that.current = newElem;
            history.pushState(null, null, href);
          
            if(callback) {
                callback(true);
            }
        });
    };
    
    Swapper.prototype.back = function() {
        if(this.loaded.length > 1) {
            var old = this.loaded.pop();
            var current = this.loaded[this.loaded.length-1];
            
            old.elem.remove();
            this.current = current.elem.appendTo(this.attachElem).show();
        }
    };
    
    Swapper.prototype._addPrefixedEventListener = function(elem, type, callback) {
        for(var i = 0; i < prefixes.length; i++) {
            if(prefixes[i] === '') {
                type = type.toLowerCase();
            }
            elem.addEventListener(prefixes[i] + type, callback);
        }
    };
    
    var prefixes = ['webkit', 'moz', 'MS', 'o', ''];
    Swapper.prototype._setPrefixedStyle = function(elem, type, value) {
        for(var i = 0; i < prefixes.length; i++) {
            var prefix = prefixes[i];
            if(prefix === '') {
               type[0] = type[0].toLowerCase();
            }
            elem.style[prefix + type] = value;
        }
    };
    
    window.Swapper = Swapper;
});