var TV = (function() {
    var chosenChannel = "";
    const UNGROUPED = "БЕЗ ГРУППЫ";

    // Text that ends up inside a single-quoted JS string within an XML attribute.
    function jsText(text) {
        return String(text == null ? '' : text)
            .replace(/\\/g, "")
            .replace(/"/g, "")
            .replace(/'/g, "")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/[\r\n]+/gm, " ");
    }

    function getItem(url, show, channel, isOTT, isEDEM, fav) {
        var rusDate = show ? Utils.rusDate(show.time * 1000, { hour: 'numeric', minute: 'numeric' }) : '';
        var title = jsText(channel.title);
        var name = show ? jsText(show.name) : title;
        var desc = show ? jsText(show.descr) : '';
        var id = jsText(channel.id);
        var autoHighlight = (chosenChannel == channel.id) ? 'autoHighlight="true"' : '';
        var decoration = (show && show.rec == 1) ? '<decorationLabel class="label">&#9679;</decorationLabel>' : '';
        var img = (show && show.img) ? 'http://spacetv.in/images/' + show.img : (channel.logo || '');
        var favType = isOTT ? 'ott' : 'edem';
        // `fav` is true only for channels already in favorites, so Play must remove them.
        var onplay = fav ?
            "TV.removeFromFavorite('" + id + "', '" + favType + "')" :
            "TV.addToFavorite('" + id + "', '" + favType + "')";
        var onholdselect = '';
        if ((isOTT || isEDEM) && show && show.rec == 1) {
            var programId = jsText(isEDEM ? show.ch_id : channel.id);
            onholdselect = 'onholdselect="TV.setChosenChannel(\'' + id + '\'); TV.showTVProgram(\'' + programId + '\', \'' + title + '\', \'' + show.time + '\', \'' + channel.url + '\', \'' + favType + '\')"';
        }
        return '<listItemLockup ' + autoHighlight + ' style="height: 90;" onplay="' + onplay + '" ' + onholdselect + ' onselect="TV.setChosenChannel(\'' + id + '\'); playTV(\'' + channel.url + '\', \'' + title + '\', \'' + name + '\', \'' + desc + '\', \'' + img + '\', \'' + url + '\')"><img style="tv-placeholder:tv; tv-position:left; margin: 0 20;" src ="' + img + '" width="90" height="90" /><title style="tv-align:left; margin: 0 20;">' + title + '</title><subtitle class="text">' + rusDate + ' ' + name + '</subtitle>' + decoration + '</listItemLockup>';
    }

    function getSimpleItem(channel) {
        var title = jsText(channel.title);
        return '<lockup onselect="playTV(\'' + channel.url + '\', \'' + title + '\', null , null, null)"><img style="tv-placeholder:tv;" src ="' + (channel.logo || '') + '" width="160" height="160" /><title>' + title + '</title></lockup>';
    }

    function showForChannel(resultNow, channel, options) {
        if (options.isOTT) { return resultNow[channel.id]; }
        if (options.isEDEM) {
            return Object.values(resultNow).find(show => show.channel_name && show.channel_name.indexOf(channel.title) > -1);
        }
        return null;
    }

    function grid(header, items) {
        if (!items) { return ''; }
        return '<grid rowCount="3" style="tv-line-spacing: 30; tv-interim-spacing: 30; margin: 0 0 80 0"><header><title>' + header + '</title></header><section>' + items + '</section></grid>';
    }

    function loadProgram(options, callback) {
        // Only OTT/edem playlists have an EPG source; everything else renders directly.
        if (!options.isOTT && !options.isEDEM) {
            var channels = options.results.map(getSimpleItem).join("");
            callback(grid('Каналы', channels));
            return;
        }

        var favID = (options.isOTT) ? 'favoriteChannels' : 'edemFavoriteChannels';
        var savedFavorites = AppStorage.getItem(favID);
        var favoriteChannels = savedFavorites ? savedFavorites.split(',') : [];

        API.getProgramNow(function(resultNow) {
            resultNow = resultNow || {};
            var allChannels = '';

            if (favoriteChannels.length > 0) {
                var favItems = '';
                favoriteChannels.forEach(favId => {
                    options.results.forEach(channel => {
                        if (favId == channel.id) {
                            favItems += getItem(options.url, showForChannel(resultNow, channel, options), channel, options.isOTT, options.isEDEM, true);
                        }
                    });
                });
                allChannels += grid('ИЗБРАННЫЕ', favItems);
            }

            var groups = Utils.unique(options.results);
            groups.forEach(group => {
                var items = '';
                options.results.forEach(channel => {
                    if (channel.group == group) {
                        items += getItem(options.url, showForChannel(resultNow, channel, options), channel, options.isOTT, options.isEDEM);
                    }
                });
                allChannels += grid(String(group).toUpperCase(), items);
            });

            // Channels without a group-title would otherwise be unreachable.
            var ungrouped = '';
            options.results.forEach(channel => {
                if (!channel.group) {
                    ungrouped += getItem(options.url, showForChannel(resultNow, channel, options), channel, options.isOTT, options.isEDEM);
                }
            });
            allChannels += grid(UNGROUPED, ungrouped);

            callback(allChannels);
        });
    }

    function parseExtInf(line, channel) {
        var comma = line.indexOf(',');
        var attributes = (comma > -1) ? line.slice(0, comma) : line;
        // Everything after the first comma is the display name, commas included.
        channel.title = (comma > -1) ? line.slice(comma + 1).trim() : '';
        var group = attributes.match(/group-title="([^"]*)"/i);
        var logo = attributes.match(/tvg-logo="([^"]*)"/i);
        var tvgId = attributes.match(/tvg-id="([^"]*)"/i);
        if (group && group[1]) { channel.group = group[1]; }
        if (logo && logo[1]) { channel.logo = logo[1]; }
        if (tvgId && tvgId[1]) { channel.tvgId = tvgId[1]; }
    }

    function parsePlaylist(text, isOTT, isEDEM) {
        var results = [];
        var channel = {};
        text.split('\n').forEach(rawLine => {
            var line = rawLine.replace(/\n/g, "").replace(/\r/g, "").trim();
            if (line.length == 0) { return; }
            if (line.indexOf("#EXTINF") == 0) {
                parseExtInf(line, channel);
            } else if (line.indexOf("#EXTGRP") == 0) {
                channel.group = line.split(':')[1];
            } else if (line.charAt(0) == '#') {
                // #EXTM3U, #EXTVLCOPT, comments — nothing to collect.
            } else {
                channel.url = line;
                channel.id = channel.tvgId || 0;
                if (isOTT) { channel.id = line.replace(/.+\/(.+?)\.m3u8/, '$1'); }
                if (isEDEM) { channel.id = line.replace(/.+\/(.+?)\/index\.m3u8/, '$1'); }
                if (!channel.title) { channel.title = line; }
                results.push(channel);
                channel = {};
            }
        });
        return results;
    }

    return {
        // Exposed for the build's smoke test and for debugging a playlist by hand.
        parsePlaylist: parsePlaylist,

        showTVProgram(id, channelName, time, stream, type) {
            Presenter.showLoading('Загрузка программы');
            API.getProgram(id, function(result) {
                if (!result || !result.epg_data) {
                    Presenter.removeLoadingTemplate();
                    showText('Программа передач недоступна.', channelName);
                    return;
                }
                var arhiv = [],
                    program = [];
                result.epg_data.forEach(show => {
                    var currentDate = new Date;
                    var date = new Date(show.time * 1000);
                    var item = TVTemplates.fragments.item(show, stream, channelName, type, time);
                    (date > currentDate) ? program.push(item): arhiv.push(item);
                });
                var template = TVTemplates.tvProgramPage(arhiv, program);
                var doc = Presenter.makeDocument(template, true);
                Presenter.pushDocument(doc);
            });
        },

        parseM3U(url, title) {
            var template = Templates.loading('Загрузка плейлиста');
            var doc = Presenter.makeDocument(template, true);
            Presenter.pushDocument(doc);
            var domImplementation = doc.implementation;
            var lsParser = domImplementation.createLSParser(1, null);
            var lsInput = domImplementation.createLSInput();
            var isOTT = (title.toLowerCase().indexOf("ott") == 0);
            var isEDEM = (title.toLowerCase().indexOf("edem") >= 0);
            var options = { title: title, url: url, isOTT: isOTT, isEDEM: isEDEM, results: [] }

            function render(allChannels) {
                var page = TVTemplates.playlistPage(title, allChannels);
                lsInput.stringData = Utils.escapeForParser(page);
                lsParser.parseWithContext(lsInput, doc.getElementsByTagName("document").item(0), 5);
            }

            doc.addEventListener("load", function() {
                API.getPlaylist(url, function(result) {
                    if (!result || result.indexOf("#EXT") == -1) {
                        render(Templates.fragments.list('Не удалось загрузить плейлист.'));
                        return;
                    }
                    options.results = parsePlaylist(result, isOTT, isEDEM);
                    if (options.results.length == 0) {
                        render(Templates.fragments.list('В плейлисте нет каналов.'));
                        return;
                    }
                    loadProgram(options, render);
                });
            });

            doc.addEventListener("appear", function() {
                if (options.results.length == 0) { return; }
                loadProgram(options, function(allChannels) {
                    lsInput.stringData = Utils.escapeForParser(allChannels);
                    lsParser.parseWithContext(lsInput, doc.getElementsByTagName("collectionList").item(0), 2);
                });
            });
        },

        setChosenChannel(id) {
            chosenChannel = id;
        },

        addToFavorite(id, type) {
            var favID = (type == 'ott') ? 'favoriteChannels' : 'edemFavoriteChannels';
            var saved = AppStorage.getItem(favID);
            var newFavorite = saved ? saved.split(',') : [];
            if (newFavorite.indexOf(id.toString()) > -1) { return; }
            newFavorite.push(id);
            AppStorage.setItem(favID, newFavorite.join());
        },

        removeFromFavorite(id, type) {
            var favID = (type == 'ott') ? 'favoriteChannels' : 'edemFavoriteChannels';
            var saved = AppStorage.getItem(favID);
            if (!saved) { return; }
            var oldFavorite = saved.split(',').filter(favId => favId != id.toString());
            if (oldFavorite.length > 0) {
                AppStorage.setItem(favID, oldFavorite.join());
            } else {
                AppStorage.removeItem(favID);
            }
        }
    }
}());
