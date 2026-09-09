var AfterLoad = (function() {
    const KEY = "runAfterLoad";
    var _options;

    return {
        get() {
            var runOptions = localStorage.getItem(KEY);
            if (runOptions) {
                // Corrupt storage here used to throw during initApp.
                runAfterLoad = Utils.parseJSON(runOptions, undefined);
                AfterLoad.remove();
            }
        },
        set(options) {
            _options = options
        },
        save() {
            if (_options) {
                localStorage.setItem(KEY, JSON.stringify(_options));
            }
        },
        clear() {
            _options = undefined;
        },
        remove() {
            localStorage.removeItem(KEY);
        }
    }
}());