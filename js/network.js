var Network = (function() {
    var retryRequests = []
    //var retryRequest

    function showError(xhr) {
        var buttons = '<button onselect="Network.retry()"><text>Повторить</text></button><button onselect="globalClearStorage()"><text>Сбросить приложение</text></button>';
        var desc = '';
        console.log(xhr)
        if (xhr.status == 502) { desc = 'Сервис временно не доступен.\n' }
        desc += 'status: ' + xhr.status// + ' ' + xhr.responseText;
        console.log(desc)
        var template = Templates.alert("Ошибка", desc, buttons);
        var doc = Presenter.makeDocument(template, true);
        if (getActiveDocument().error) { Presenter.replaceDocument(doc); } else { Presenter.pushDocument(doc); }
        doc.error = true;
    }

    function showErrorMessage(message) {
        var buttons = '<button onselect="Network.retry()"><text>Повторить</text></button><button onselect="globalClearStorage()"><text>Сбросить приложение</text></button>';
        var desc = message;
        console.log(desc)
        var template = Templates.alert("Ошибка", desc, buttons);
        var doc = Presenter.makeDocument(template, true);
        if (getActiveDocument().error) { Presenter.replaceDocument(doc); } else { Presenter.pushDocument(doc); }
        doc.error = true;
    }

    return {
        loadItemsFrom(options, callback, ignoreCache = false) {
            var page = options.page || 0
            var filterKey = '';
            try { filterKey = options.filters ? JSON.stringify(options.filters) : ''; } catch (e) { filterKey = ''; }
            var key = options.items + options.from + options.id + options.type + 'page' + page + filterKey
            var result = Cache.get(key);
            if (result != undefined && !ignoreCache) {
                console.log('Loading "' + key + '" from cache');
                if (callback) { callback(result, options) };
                return;
            }

            var _callback = function(xhr) {
                var status = xhr.status;
                var json = Utils.parseJSON(xhr, { status: 0 });
                if (status == 401 || json.status == 401) {
                    authErrors.push('Token n status: ' + xhr.status + ' ' + xhr.responseText);
                    Log.sendLog('Token n status: ' + xhr.status + ' ' + xhr.responseText)
                    if (!Auth.check()) { showActivationPage(); }
                } else if (status == 200) {
                    var parsed = xhr.responseText ? Utils.parseJSON(xhr) : xhr;
                    var unparseable = (parsed === undefined);
                    // An empty or unparseable body falls back to the xhr itself so
                    // callers checking result.status keep working — but that object
                    // must never be cached, or every revisit inside the 60s window
                    // replays it to callers expecting result.items.
                    var isFallback = unparseable || !xhr.responseText;
                    if (unparseable) {
                        // Pass the xhr through, matching what the empty-body case
                        // already does — callers that check result.status still work,
                        // and a request nobody is waiting on stays silent.
                        console.log('Unparseable 200 for "' + key + '", passing the response through');
                    }
                    var result = unparseable ? xhr : parsed;

                    if (!unparseable && xhr.responseText && result && typeof result.error !== 'undefined') {
                        retryRequests.push({'options' : options, 'callback' : callback})
                        showErrorMessage(result.error)
                        if (callback) { callback(null, null, xhr) }
                    } else {
                        if (!isFallback) {
                            // Reference data barely changes; shelves do. The caller
                            // declares which this is.
                            Cache.set(key, result, options.cacheTTL || Cache.TTL.listing, options.persist);
                        }
                        if (callback) {
                            try { callback(result, options) }
                            catch (e) { console.log('Callback failed for "' + key + '": ' + e); }
                        }
                    }
                } else {
                    retryRequests.push({'options' : options, 'callback' : callback})
                    showError(xhr)
                    if (callback) { callback(null, null, xhr) }
                }
            }
            API.loadItemsFrom(options, _callback)
        },

        retry() {
            var requests = retryRequests;
            retryRequests = [];
            while(requests.length){
                var request = requests.shift();
                Network.loadItemsFrom(request.options, request.callback);
                Presenter.dismissModal();
            }
            
        },

        log() {
            console.log(retryRequests)
        }
    }
}());