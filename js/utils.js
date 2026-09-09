var Utils = {
    _entityMap: {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '`': '&#x60;',
        '"': '',
        "'": '',
        "\\": '&#92;'
    },
    // Escapes a fragment for LSParser/DOMParser. Unlike a blanket /&/g pass this
    // leaves existing entities (&amp; &lt; &#171; ...) alone instead of turning
    // them into visible "&amp;lt;" text.
    // For plain TEXT that gets inserted into markup (CHANGELOG, plots, comments,
    // biographies). Unlike escapeForParser this escapes < and >, which would
    // otherwise reach the XML parser as raw markup and throw.
    escapeText(string) {
        return String(string == null ? '' : string)
            .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#[xX][0-9a-fA-F]+);)/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    },
    escapeForParser(string) {
        return String(string == null ? '' : string)
            .replace(/&(?!(?:[a-zA-Z][a-zA-Z0-9]*|#[0-9]+|#[xX][0-9a-fA-F]+);)/g, "&amp;")
            .replace(/'/g, "&apos;");
    },
    // status 0 means the request failed and responseText is "", which made every
    // bare JSON.parse(xhr.responseText) throw inside an XHR handler.
    parseJSON(xhr, fallback) {
        try {
            var text = (xhr && typeof xhr === 'object') ? xhr.responseText : xhr;
            if (!text || !String(text).trim()) { return fallback; }
            var parsed = JSON.parse(text);
            return (parsed === null || parsed === undefined) ? fallback : parsed;
        } catch (e) {
            console.log('parseJSON failed: ' + e);
            return fallback;
        }
    },
    escapeHtml: function(string) {
        var self = this;
        return String(string).replace(/[&<>`"'\\]/g, function(s) {
            return self._entityMap[s];
        });
    },
    decodeCharacters(text) {
        return String(text == null ? '' : text).replace(/&apos;/g, '"').replace(/&laquo;/g, "«").replace(/&raquo;/g, "»").replace(/&#171;/g, "«").replace(/&#187;/g, "»").replace(/&#8211;/g, "–");
    },
    splitTitle(title) {
        var titles = title.split(" / ");
        var title = titles[0] ? Utils.replaceText(Utils.escapeHtml(titles[0].trim())) : "";
        var subtitle = titles[1] ? Utils.replaceText(Utils.escapeHtml(titles[1].trim())) : "";
        return { title: title, subtitle: subtitle };
    },
    declOfNum(number, titles) {
        var cases = [2, 0, 1, 1, 1, 2];
        return titles[(number % 100 > 4 && number % 100 < 20) ? 2 : cases[(number % 10 < 5) ? number % 10 : 5]];
    },
    rusDate(dateString, options) {
        var date = dateString ? new Date(dateString) : new Date();
        options = options || { year: 'numeric', month: 'long', day: 'numeric' };
        return date.toLocaleString("ru", options);
    },
    replaceText(text) {
        return String(text == null ? '' : text).replace(/"/g, "").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "").replace(/[\r\n]+/gm, " ");
    },
    fixIMDB(id) {
        for (var i = id.toString().length; i < 7; i++) {
            id = "0" + id;
        }
        return id;
    },
    getMax(arr, prop) {
        var max;
        for (var i = 0; i < arr.length; i++) {
            if (arr[i].depth == 0) {
                if (!max || parseInt(arr[i][prop]) > parseInt(max[prop]))
                    max = arr[i];
            }
        }
        return max;
    },
    shuffleFunction(a) {
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    },
    shuffle(a) {
        var j, x, i;
        for (i = a.length - 1; i > 0; i--) {
            j = Math.floor(Math.random() * (i + 1));
            x = a[i];
            a[i] = a[j];
            a[j] = x;
        }
        return a;
    },
    unique(arr) {
        var obj = {};
        for (var i = 0; i < arr.length; i++) {
            if (arr[i].group) {
                var str = arr[i].group;
                obj[str] = true; // запомнить строку в виде свойства объекта     
            }
        }
        return Object.keys(obj);
    },
    range(start, end) {
        if (start === end) return [start];
        return [start, ...Utils.range(start + 1, end)];
    },
    isSerial(item) {
        return (item.type == 'serial' || item.type == 'docuserial' || item.type == 'tvshow');
    },
    isNative() {
        if (Device.appIdentifier.includes('popov') && Device.appVersion < 13) { return true; }
        if (~Device.appIdentifier.toLowerCase().indexOf('qello')) { return true; }
        //return !!~Device.appIdentifier.toLowerCase().indexOf('qello');
        return !AppSettings.getAll().customPlayer.id;
    },
    spoiler(message, show = false) {
        var regex = /<spoiler>(.*?)<\/spoiler*>/g;
        return String(message == null ? '' : message).replace(regex, function(match, inner) {
            return show ? inner : "[SPOILER]";
        });
    },
    remove(array, element) {
        var index = array.indexOf(element);
        if (index > -1) {
            array.splice(index, 1);
        }
    },
    appName() {
        var name = 'unknown';
        if (Device.appIdentifier.includes('popov')) { name = Device.appIdentifier.replace('popov.', ''); }
        if (Device.appIdentifier.includes('kozlov')) { name = 'EasyTV' }
        if (Device.appIdentifier.includes('morozov')) { name = 'Tiny IPTV' }
        if (Device.appIdentifier.includes('octavian')) { name = 'Micro IPTV' }
        if (Device.appIdentifier.includes('qello')) { name = 'Qello' }
        if (Device.appIdentifier.includes('qinoa')) { name = 'Qinoa' }
        name += ' ' + Device.appVersion;
        return name;
    },
    hideAnime(result, options) {
        if (options.id != "history" && options.id != "collections" && options.id != "unwatched") {
            result.items = result.items.filter(item => !item.genres.map(a=>a.id).includes(25));
        }
    },
    onlyCartoon(result) {
        result.items = result.items.filter(item => item.genres.map(a=>a.id).includes(23));
    },
    findFirst(arr, predicate) {
        var foundIndex = arr.findIndex(predicate);
        return foundIndex !== -1 ? arr[foundIndex] : null;
    },
    replaceElement(string, elementTag, elementID, action, doc) {
        var parser = Presenter.activeParser(doc);
        var element = (elementTag) ? parser.doc.getElementsByTagName(elementTag).item(0) : parser.doc.getElementById(elementID);
        if (!element) { console.log('replaceElement: no target for ' + (elementTag || elementID)); return; }
        try {
            parser.lsInput.stringData = Utils.escapeForParser(string);
            parser.lsParser.parseWithContext(parser.lsInput, element, action);
        } catch (e) {
            console.log('replaceElement: could not parse fragment for ' + (elementTag || elementID) + ': ' + e);
        }
    },
    replaceCdn(url) {
        if (!KINOPUB.oldCdnUrl) {
            return url;
        }
        if (url && typeof url === 'string') {
            if (KINOPUB.replaceApiCdn) {
                const urlWithoutProtocol = url.replace(/^https?:\/\//, '');
                const urlPath = urlWithoutProtocol.split('/').slice(1).join('/');
                return KINOPUB.cdnUrl + '/' + urlPath;
            }

            return url.replace(KINOPUB.oldCdnUrl, KINOPUB.cdnUrl);
        }

        return url;
    },
    replacePlaylist(playlist) {
        // const usePlaylistProxy = AppSettings.get('usePlaylistProxy');
        // if (usePlaylistProxy && usePlaylistProxy.id) {
        //     const proxied = playlist.replace(/(https:\/\/[^\/]+\/hls)/, `${KINOPUB.proxyUrl}/hls`);
        //     console.log('Proxy URL: ' + proxied);
        //     return proxied;
        // }
        return playlist;
    },
    getByKey(text, key) {
        return String.fromCharCode(...text.match(/.{1,2}/g)
         .map((e,i) => 
           parseInt(e, 16) ^ key.charCodeAt(i % key.length) % 255)
         )
    },
    getRandom() {
        const min = 2;
        const max = 128;
        const length = Math.floor(Math.random() * (max - min + 1) + min);
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

        let result = '';
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }
};
