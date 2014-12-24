(function() {
    window.util = {
        prefixes: ['webkit', 'moz', 'MS', 'o', ''],
        addPrefixedEventListener: function(elem, type, callback) {
            var p = window.util.prefixes;
            for(var i = 0; i < p.length; i++) {
                if(p[i] === '') {
                    type = type.toLowerCase();
                }
                elem.addEventListener(p[i]+type, callback, false);
            }
        },
        
        removePrefixedEventListener: function(elem, type, callback) {
            var p = window.util.prefixes;
            for(var i = 0; i < p.length; i++) {
                if(p[i] === '') {
                    type = type.toLowerCase();
                }
                elem.removeEventListener(p[i]+type, callback);
            }
        },
    };
}());