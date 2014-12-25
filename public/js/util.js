(function() {
    window.util = {
        prefixes: ['webkit', 'moz', 'MS', 'o', ''],
        
        /**
         * Adds a prefixed event listener to a given element
         *
         * @param HtmlElement elem The element to add the listener to
         * @param string type The unprefixed type of the element to add the
         *                    listener for
         * @param [function] callback The callback to call when the event is
         *                   heard
         */
        addPrefixedEventListener: function(elem, type, callback) {
            var p = window.util.prefixes;
            for(var i = 0; i < p.length; i++) {
                if(p[i] === '') {
                    type = type.toLowerCase();
                }
                elem.addEventListener(p[i]+type, callback, false);
            }
        },
        
        /**
         * Removes a prefixed event listener from the given element
         *
         * @param HtmlElement elem The element to remove the listener from
         * @param string type The unprefixed type of the event to remove the
         *                    listener for
         * @param [function] callback The callback to remove
         */
        removePrefixedEventListener: function(elem, type, callback) {
            var p = window.util.prefixes;
            for(var i = 0; i < p.length; i++) {
                if(p[i] === '') {
                    type = type.toLowerCase();
                }
                elem.removeEventListener(p[i]+type, callback);
            }
        },
        
        /**
         * Sets vendor prefixed properties on the given element
         *
         * @param HtmlElement elem The element to set the style of
         * @param string property The unprefixed CSS property to set
         * @param string value The value to set the CSS property to
         */
        setPrefixedStyle: function(elem, property, value) {
            var p = window.util.prefixes;
            for(var i = 0; i < p.length; i++) {
                var prefix = p[i];
                if(p[i] !== '') {
                    prefix = '-' + prefix + '-';
                }
                elem.style[prefix + type] = value;
            }
        },
    };
}());