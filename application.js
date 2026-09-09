var baseURL;
var APP_VERSION = "1.60.0";
var MenuItemDoc;
var cachedResult;
var globalCheckAuthInterval;
var globalCachePurgerInterval;
var runAfterLoad;
var isPlaying = false;
var authErrors = [];
var activationAttempts = 0;
var skipCache = false;
var DEV = false;
var menuDoc;
var hashConfig = {};
var bootOptions = {};

// Replaced with `true` by the bundler (see build/build.mjs). In the bundled build
// every module is already inlined, so there is nothing to evaluateScripts().
var IS_BUNDLED = (typeof __BUNDLED__ !== 'undefined') && __BUNDLED__;

// Boot Helpers
function getLoadingString(title) {
    title = title || "Загрузка"
    const template = `
      <document>
          <loadingTemplate>
              <activityIndicator>
                  <title>${title}</title>
              </activityIndicator>
          </loadingTemplate>
      </document>
  `;
    return template
}

function showAlert(information, buttons) {
    var result = JSON.stringify(information);
    var buttons = buttons || '';
    var template = '<document><alertTemplate><title>Ошибка</title><description>' + result + '</description>' + buttons + '</alertTemplate></document>';
    var templateParser = new DOMParser();
    var parsedTemplate = templateParser.parseFromString(template, "application/xml");
    navigationDocument.pushDocument(parsedTemplate);
}

function checkDEV() {
    var rawFile = new XMLHttpRequest();
    rawFile.open("GET", baseURL + "DEV", false);
    rawFile.onreadystatechange = function () {
        if(rawFile.readyState === 4) {
            if(rawFile.status === 200 || rawFile.status == 0) {
                DEV = true;
                console.log("DEV MODE")
            }
        }
    }
    rawFile.send(null);
}

//re-write console.log() to DEV MODE
// var log = console.log;
// var console = {
//   log: function() {
//     if (DEV) { log.apply(console, arguments); }
//   }
// };

// re-route console.log() to XCode debug window
// var console = {
//   log: function() {
//     var message = '';
//     for(var i = 0; i < arguments.length; i++) {
//         message += JSON.stringify(arguments[i]) + ' '
//     };
//     swiftInterfaceLog(message)
//   },
//   error: function() {
//     var message = '';
//     for(var i = 0; i < arguments.length; i++) {
//         message += JSON.stringify(arguments[i]) + ' '
//     };
//     swiftInterfaceLog(message)
//   }
// };

// MARK: - APP
App.onLaunch = function(options) {
    console.log(options);
    bootOptions = options || {};
    baseURL = options.BASEURL;
    if (baseURL && baseURL[baseURL.length - 1] !== "/") {
      baseURL += '/';
    }

    if (options.location) {
        var hash = options.location.split('#')[1];
        if (hash) {
            hashConfig = hash.split('&').reduce(function (result, item) {
                var parts = item.split('=');
                result[parts[0]] = parts[1];
                return result;
            }, {});
        }
    }

    var timestamp = Date.now();
    if (baseURL[baseURL.length - 1] != '/') { baseURL += '/'; }
    const javascriptFiles = [
        "afterLoad",
        "consts",
        "utils",
        "storage",
        "settings",
        "md5",
        "ajax",
        "api",
        "auth",
        "cache",
        "templates",
        "presenter",
        "kp",
        "kinopoisk",
        "kinopoisk2",
        "trakt",
        "tmdb",
        "kplayer",
        "tv",
        "log",
        "network",
        "kpspeed",
        "fanart"
    ].map(moduleName => `${baseURL}js/${moduleName}.js?t=${timestamp}`);

    let loadingString = getLoadingString();
    let loadingDocument = new DOMParser().parseFromString(loadingString, "application/xml");
    if (typeof navigationDocument !== "undefined") {
        navigationDocument.pushDocument(loadingDocument);
    }

    if (IS_BUNDLED) {
        checkDEV();
        setTimeout(bootstrap, 1000);
        return;
    }

    evaluateScripts(javascriptFiles, function(success) {
        if (success) {
            bootstrap();
        } else {
            showAlert("Произошла ошибка при загрузке внешних модулей. Проверьте ваше подключение к интернету и повторите попытку позже, перезагрузив приложение. На пульте Apple TV Remote дважды быстро нажмите кнопку «Домой». Смахните вверх по поверхности Touch на пульте Apple TV Remote.");
            throw new EvalError("TVMLCatalog application.js: unable to evaluate scripts.");
        }
    });

    checkDEV();
}

// Shared boot sequence for both the evaluateScripts path and the bundled path.
function bootstrap() {
    AppSettings.populate(hashConfig);
    API.update();
    if (Auth.check()) { initApp(); } else { showActivationPage(); }
    if (bootOptions.AS_PLAYLIST && bootOptions.AS_PLAYLIST == "true") {
        showSetDefaultUrlAlert();
    }
}

App.onResume = function(options) {
    //console.log(options);
    checkVersion()
    KP.checkNewVersion();
}

App.onDidEnterBackground = function(options) {
    AfterLoad.save();
    console.log("onDidEnterBackground")
}

App.onWillEnterForeground = function(options) {
    AfterLoad.remove();
    console.log("onWillEnterForeground")
}

App.onWillTerminate = function(options) {
    //AfterLoad.remove();
    //swiftInterfaceLog("onWillTerminate")
}

function showSetDefaultUrlAlert() {
    if (AppStorage.getData(KEYS.defaultBootUrlDenied)) {
        return;
    }

    var buttonYES = 'onselect="setDefaultUrl();"';
    var buttonNO = 'onselect="noDefaultUrl();"';
    var template = Templates.descriptiveAlert("Открывать автоматически при запуске приложения?", "Плейлист обнаружен", { buttonYES: buttonYES, buttonNO: buttonNO });
    var doc = Presenter.makeDocument(template, true);
    Presenter.modalDocument(doc);
}

function setDefaultUrl() {
    AppSettings.setDefaultUrl();
    navigationDocument.dismissModal();
}

function noDefaultUrl() {
    AppStorage.setData(KEYS.defaultBootUrlDenied, "true");
    navigationDocument.dismissModal();
}

function initApp() {
    console.log("initApp");
    API.deviceNotify();
    menuBar();
    KP.loadUserInfo();
    KP.loadReferences();

    checkVersion();

    // Check auth interval
    globalCheckAuthInterval = setInterval(function() {
        console.log("GlobalCheckAuthInterval");
        //Auth.check();
        if (!Auth.check()) { showActivationPage(); }
        if (Trakt.needsRefresh()) { Trakt.traktGetTokenByRefreshToken() }
    }, 3600000);

    // Cache purger interval
    globalCachePurgerInterval = setInterval(function() {
        Cache.scan();
    }, 5000);

    if (!runAfterLoad) { AfterLoad.get(); }
    if (runAfterLoad) { run(runAfterLoad.id, runAfterLoad.type, runAfterLoad.action) }
}

// MenuBar methods
function menuBar() {
    var settings = AppSettings.getAll();
    var template = settings.cartoonMode.id ? Templates.menuBarChild() : Templates.menuBar();
    var doc = Presenter.makeDocument(template);
    doc.addEventListener("select", handleSelectEvent);
    Presenter.replaceDocument(doc, menuDoc);
    menuDoc = doc;
}

function handleSelectEvent(event) {
    var selectedElement = event.target;
    var targetFunction = selectedElement.getAttribute("id");
    if (selectedElement.tagName == "menuItem") {
        updateMenuItem(selectedElement, targetFunction);
    }
}

function updateMenuItem(menuItem, targetFunction) {
    var menuItemDocument = menuItem.parentNode.getFeature("MenuBarDocument");
    switch (targetFunction) {
        case 'MoviesPage':
            KP.moviesPage();
            break;
        case 'ShowsPage':
            KP.showsPage();
            break;
        case 'MySubscribes':
            KP.mySubscribesPage();
            break;
        case 'AllMovies':
            KP.libraryPage();
            break;
        case 'Search':
            KP.searchPage();
            break;
        case 'TV':
            KP.TVPage();
            break;
        case 'Settings':
            KP.settingsPage();
            break;
        case 'ChildMoviesPage':
            KP.childMoviesPage();
            break;
        default:
            break;
    }
    menuItemDocument.setDocument(MenuItemDoc, menuItem);
}

// Activation
function showActivationPage() {
    console.log("showActivationPage");
    activationAttempts++;
    var buttons = '<button onselect="showActivationPage()"><text>Повторить</text></button>';
    if (activationAttempts > 3) { showAlert("Ошибка получения кода активации, попробуйте позднее.", buttons); return; }
    API.getDeviceCode(function(xhr) {
        console.log(xhr)
        if (xhr.status == 200) {
            var json = JSON.parse(xhr.responseText)
            if (authErrors.length > 0) {
                json.errors = authErrors.join('\n');
                authErrors = [];
            }
            showCode(json);
            var code = json.code
            var interval = setInterval(function() {
                Auth.accessToken(code, function(success, wait) {
                    if (success) {
                        clearInterval(interval);
                        initApp();
                    }
                    if (!wait && !success) {
                        API.getDeviceCode(function(xhr) {
                            var description = getActiveDocument().documentElement.getElementsByTagName("description").item(0),
                                json = JSON.parse(xhr.responseText);
                            if (description) {
                                description.textContent = json.user_code;
                                code = json.code;
                            }
                        });
                    }
                })
            }, parseInt(json.interval) * 1000);
        } else if (xhr.status == 503) {
            showActivationPage();
        } else {
            showAlert("Ошибка получения кода активации, попробуйте позднее. Ошибка " + xhr.status, buttons);
        }
    })
}

function showCode(result) {
    var template = Templates.showCode(result.user_code, null, result.errors);
    var doc = Presenter.makeDocument(template);
    Presenter.replaceDocument(doc, navigationDocument.documents[0]);
}

// Play methods
function play(episode, season, id) {
    if (id) {
        KP.loadItemDetail(id, null, null, function(result, options) {
            cachedResult = result
                //Presenter.removeLoadingTemplate();
            KPlayer.play(episode, season);
        });
    } else { KPlayer.play(episode, season); }
}

function playFewEp(episode, season, numberItems) {
    KPlayer.play(episode, season, false, numberItems);
}

function playShuffle() {
    KPlayer.play(0, 0, true);
}

function playTrailer(url) {
    KPlayer.playTrailer(url);
}

function playTV(stream, title, subtitle, description, image, url, time) {
    KPlayer.playTV(stream, title, image, subtitle, description, time);
}

// Methods called from Swift
function tinyPlayerTimeDidChange(id, time, video, season) {
    KPlayer.playerTimeDidChange(id, time, video, season)
}

function tinyPlayerStateDidChange(state, item, time, duration, season, trakt) {
    KPlayer.playerStateDidChange(state, item || (cachedResult && cachedResult.item), time, duration, season, trakt)
}

// Methods called from Swift, For MicroIPTV
function microPlayerTimeDidChange(id, time, video, season) {
    KPlayer.playerTimeDidChange(id, time, video, season)
}

function microPlayerStateDidChange(state, item, time, duration, season, trakt) {
    KPlayer.playerStateDidChange(state, item || (cachedResult && cachedResult.item), time, duration, season, trakt)
}

function run(id, type, action) {
    if (typeof KP === 'undefined') {
        runAfterLoad = { id: id, type: type, action: action }
        return;
    }
    if (action == 'show') {
        KP.loadItemDetail(id, type)
    } else {
        play(null, null, id)
    }
    runAfterLoad = undefined;
}

// Helper methods
function showRating(id, rating, type) {
    var template = Templates.ratingPage(rating);
    var doc = Presenter.makeDocument(template, true);
    doc.addEventListener("change", function(event) {
        type = (type == "movie") ? 'movies' : 'shows';
        API.setTraktRating(type, event, id, function(xhr) {
            console.log(xhr);
            Presenter.dismissModal();
        });
    });
    Presenter.modalDocument(doc);
}

function showText(text, title) {
    var template = Templates.descriptiveAlert(text, title);
    var doc = Presenter.makeDocument(template, true);
    Presenter.modalDocument(doc);
}

// Background Fetchs
function backgroundFetch() {
    var settings = AppSettings.getAll();
    console.log("background fetch");

    // Update TopShelf
    if (!settings.backgroundUpdateTopShelf) { return; }
    switch (settings.userTopShelfOption) {
        case topShelfOptions.unwatched:
            var itemsToLoad = [{ items: 'watching', type: 'serial', from: 'serials', id: 'unwatched', title: 'Недосмотренные сериалы', filters: { subscribed: 1 } },
                { items: 'watching', type: 'movie', from: 'movies', id: 'unwatched', title: 'Недосмотренные фильмы' }
            ];;
            break;
        case topShelfOptions.premier:
        case topShelfOptions.hotMovies:
            var itemsToLoad = [{ items: 'items', type: 'movie', from: 'hot', id: 'hot', title: 'Горячие фильмы' }];
            break;
        case topShelfOptions.popularMovies:
            var itemsToLoad = [{ items: 'items', type: 'movie', from: 'popular', id: 'populart', title: 'Популярные фильмы' }];
            break;
        default:
            return;
    }
    for (var index in itemsToLoad) {
        Network.loadItemsFrom(itemsToLoad[index], function(result, options) {
            if (result.items.length == 0) { return; }
            if (options.id == "unwatched") {
                KP.saveTopShelf(result.items, topShelfOptions.unwatched, options.title);
            } else {
                KP.saveTopShelf(result.items, settings.userTopShelfOption);
            }
        });
    }
}

// Referenced from markup (Network error screens) but previously only defined in bundle.js.
function globalClearStorage() {
    AppSettings.removeDefaultUrl();
    [KEYS.accessToken, KEYS.refreshToken, KEYS.tokenExpires].forEach(function(key) {
        try { AppStorage.removeItem(key) } catch (e) { console.log('clear failed for ' + key, e) }
    });
    [KEYS.accessToken, KEYS.refreshToken].forEach(function(key) {
        try { AppStorage.removeData(key) } catch (e) { console.log('clear failed for ' + key, e) }
    });
    showAlert("Приложение сброшено. Перезапустите его.");
}

// Used by templates.js and kp.js. Some hosts inject it natively — only fill the gap.
if (typeof formatDuration !== 'function') {
    formatDuration = function(seconds) {
        seconds = parseInt(seconds, 10);
        if (!seconds || seconds < 0) { return '0:00'; }
        var hours = Math.floor(seconds / 3600);
        var minutes = Math.floor((seconds % 3600) / 60);
        var secs = Math.floor(seconds % 60);
        var pad = function(n) { return (n < 10 ? '0' : '') + n; };
        return hours > 0 ? hours + ':' + pad(minutes) + ':' + pad(secs) : minutes + ':' + pad(secs);
    };
}

// Transitional code for older versions
function checkVersion() {
    if (Device.appIdentifier.includes('popov') && Device.appVersion < 20) {
        needUpdate()
    }
    if (Device.appIdentifier.includes('easytv') && Device.appVersion < 8) {
        needUpdate()
    }
}

function needUpdate() {
    var text = 'Обновите установленное приложение из TetsFlight или AppStore до последней версии.';
    var title = 'Установлена старая версия';
    showText(text, title);
}

function getAuthDocument(APIBaseKinopub, url, callback) {
    needUpdate()
}

function playVideo(id, episode, season) {
    needUpdate()
}

function playEpisode(id, episode, season) {
    needUpdate()
}
