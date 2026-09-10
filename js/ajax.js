var Ajax = (function() {
    var requests = []
    // Requests are tagged with the page that issued them so the previous page's
    // work can be cancelled without touching anything else. The connection pool
    // is 6 per host, and a page issues about that many, so a page left mid-load
    // otherwise keeps the next page's first request queued behind it.
    var currentGroup = 0

    function serialize (obj) {
        var str = [];
        for(var p in obj)
            if (obj.hasOwnProperty(p)) {
                str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
            }
        return str.join("&");
    }

    function _query(method, url, headers, qParams, bParams, callback, async = true) {
        console.log(`Ajax._query [${method}] - ${url}`, headers, qParams, bParams, async);
        headers = headers || {};
        qParams = qParams || {};
        bParams = bParams || {};
        method = (method == "POST") ? "POST" : "GET";

        var xhr = new XMLHttpRequest();
        xhr.timeout = 10000;
        xhr.__group = currentGroup;
        requests.push(xhr);
        var sep = (url.indexOf("?") == -1) ? "?" : "&";
        var postBody = (method == "POST") ? JSON.stringify(bParams) : null;

        // The query string is already component-encoded, so only the base URL
        // goes through encodeURI() — running it over the whole thing is what used
        // to let a "&" inside a search term truncate the parameter.
        var queryString = serialize(qParams);
        var requestUrl = encodeURI(url);
        if (queryString) { requestUrl = requestUrl + sep + queryString; }
        xhr.open(method, requestUrl, async);
        for(var name in headers) {
            if (headers.hasOwnProperty(name)) {
                xhr.setRequestHeader(name, headers[name]);
            }
        }
        // xhr.onreadystatechange = function() {
        //     try {
        //         if (xhr.readyState == 4) {
        //             if (callback) {
        //                 callback(xhr);
        //             }
        //             Utils.remove(requests, xhr);
        //         }
        //     } catch (err) {
        //         console.error('Aborting request ' + url + '. Error: ' + err);
        //         xhr.abort();
        //         Utils.remove(requests, xhr);
        //         callback(xhr);
        //         //callback(new Error("Error making request to: " + url + " error: " + err));
        //     }
        // };
        xhr.onload = function() {
            console.log(xhr.readyState)
            if (callback) {
                callback(xhr);
            }
            Utils.remove(requests, xhr);

            try {
                var json = JSON.parse(xhr.responseText);
                if (json && json.error) {
                    Log.sendSentry(`[${method}] ${url} ${xhr.status}: ${xhr.responseText}`, xhr);
                }
            } catch (e) {
                // ignore
            }
        };
        xhr.onabort = function() {
            // A deliberate abort needs no callback and no error UI — the page it
            // belonged to is being torn down — but it must still leave the queue.
            Utils.remove(requests, xhr);
        };
        xhr.ontimeout = function() {
            console.log('timeout after ' + xhr.timeout + 'ms: ' + url);
            if (callback) {
                callback(xhr);
            }
            Utils.remove(requests, xhr);
        };
        xhr.onerror = function() {
            console.log('error status: ' + xhr.status + ' ' + xhr.responseText);
            if (callback) {
                callback(xhr);
            }
            Utils.remove(requests, xhr);

            Log.sendSentry(`[${method}] ${url} ${xhr.status}: ${xhr.responseText}`, xhr);
        };
        if (postBody) { xhr.send(postBody); } else { xhr.send(); }
        return xhr;
    }

    function appendToken(url, token) {
        var sep = (url.indexOf("?") == -1) ? "?" : "&";
        return url + sep + "access_token=" + token;
    }

    function appendUsername(url, username) {
        var sep = (url.indexOf("?") == -1) ? "?" : "&";
        return url + sep + "meta_username=" + username;
    }

    return {
        get: function(url, headers, params, callback, async) {
            return _query("GET", url, headers, params, null, callback, async);
        },

        post: function(url, headers, params, callback, async) {
            return _query("POST", url, headers, null, params, callback, async);
        },

        aget: function(url, headers, params, callback, token, async) {
            url = appendToken(url, token);
            if (typeof UserInfo !== "undefined" && UserInfo.username) {
                url = appendUsername(url, UserInfo.username);
            }
            return Ajax.get(url, headers, params, callback, async);
        },

        apost: function(url, headers, params, callback, token, async) {
            url = appendToken(url, token);
            if (typeof UserInfo !== "undefined" && UserInfo.username) {
                url = appendUsername(url, UserInfo.username);
            }
            return Ajax.post(url, headers, params, callback, async);
        },
        apostInUrl: function(url, headers, params, callback, token, async) {
            url = appendToken(url, token);
            if (typeof UserInfo !== "undefined" && UserInfo.username) {
                url = appendUsername(url, UserInfo.username);
            }
            return _query("POST", url, headers, params, params, callback, async, true);
        },
        // Starts a new page group and returns its id.
        newGroup: function() {
            currentGroup++;
            return currentGroup;
        },

        // Aborts only the requests issued under `id`. Aborted requests fire
        // neither load nor error, which is what we want for a page the user has
        // already left — nothing should render from it.
        abortGroup: function(id) {
            if (!id) { return 0; }
            var victims = [];
            var keep = [];
            requests.forEach(function(request) {
                if (request.__group === id) { victims.push(request); } else { keep.push(request); }
            });
            requests = keep;
            victims.forEach(function(request) {
                try { request.abort() } catch (e) { console.log('abort failed', e) }
            });
            if (victims.length) { console.log('Aborted ' + victims.length + ' request(s) from page ' + id); }
            return victims.length;
        },

        abortAll: function() {
            var pending = requests.slice();
            requests = [];
            pending.forEach(function(request) {
                try { request.abort() } catch (e) { console.log('abort failed', e) }
            })
        }
    }
}());