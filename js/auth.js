var UserInfo;

var Auth = (function() {
	// Distinguishes "the server rejected this refresh token" from "the request did
	// not get through". Both used to return false, and every caller treats false as
	// "make the user activate again" — so one network blip while refreshing signed
	// the user out even though their credentials were still good. Waking from sleep
	// before the network is up hits this reliably.
	const REFRESH_OK = 'ok';
	const REFRESH_REJECTED = 'rejected';   // credentials are genuinely no longer valid
	const REFRESH_UNREACHABLE = 'unreachable';   // transient: keep the session

	var retryTimer;

	function refreshToken() {
		var stored = AppStorage.getItem(KEYS.refreshToken);
		if (!stored) {
			authErrors.push('RefreshToken: none stored');
			return REFRESH_REJECTED;
		}

		var xhr = API.getRefreshToken(stored);

		if (xhr.status == 200) {
			var json = Utils.parseJSON(xhr);
			if (json && json.access_token) {
				updateStorage(json);
				API.setToken(json.access_token);
				Log.sendLog('RefreshToken done');
				return REFRESH_OK;
			}
			// A 200 we cannot read is not proof the credentials are bad.
			authErrors.push('RefreshToken: malformed 200 response');
			return REFRESH_UNREACHABLE;
		}

		var detail = 'RefreshToken status: ' + xhr.status + ' ' + (xhr.responseText || 'null') + ', state: ' + xhr.readyState;
		authErrors.push(detail);
		Log.sendLog(detail);

		// Only an explicit rejection means re-activation. Status 0 is a failed
		// request, and 5xx is the server having a bad day; neither says anything
		// about the token.
		if (xhr.status == 400 || xhr.status == 401) { return REFRESH_REJECTED; }
		return REFRESH_UNREACHABLE;
	}

	// While unreachable, keep trying quietly rather than waiting for the hourly
	// check — the session is intact and only needs the network to come back.
	function scheduleRetry() {
		if (retryTimer) { return; }
		retryTimer = setInterval(function() {
			var outcome = refreshToken();
			if (outcome === REFRESH_OK) {
				console.log('Deferred token refresh succeeded');
				clearInterval(retryTimer);
				retryTimer = undefined;
			} else if (outcome === REFRESH_REJECTED) {
				clearInterval(retryTimer);
				retryTimer = undefined;
				showActivationPage();
			}
		}, 60000);
	}

	function updateStorage(json, userDefaults = true) {
		AppStorage.setItem(KEYS.accessToken, json.access_token);
		AppStorage.setItem(KEYS.refreshToken, json.refresh_token);
		AppStorage.setItem(KEYS.tokenExpires, parseInt(new Date().getTime()/1000) + parseInt(json.expires_in));
		if (userDefaults) {
			AppStorage.setData(KEYS.accessToken, json.access_token);
			AppStorage.setData(KEYS.refreshToken, json.refresh_token);
		}
	}

	function handleRefresh() {
		var outcome = refreshToken();
		if (outcome === REFRESH_OK) { return true; }
		if (outcome === REFRESH_UNREACHABLE) {
			// Keep the session. Requests will fail while the network is down and
			// the user gets a retryable error, which beats losing the login.
			console.log('Token refresh unreachable — keeping the session and retrying');
			scheduleRetry();
			return true;
		}
		return false;
	}

	return {
		check() {
			var _accessToken = AppStorage.getItem(KEYS.accessToken),
				_refreshToken = AppStorage.getItem(KEYS.refreshToken),
				expires = AppStorage.getItem(KEYS.tokenExpires)
	
			if (!_accessToken || !_refreshToken) { 
				_accessToken = AppStorage.getData(KEYS.accessToken),
				_refreshToken = AppStorage.getData(KEYS.refreshToken),
				expires = 0
				if (!_accessToken || !_refreshToken) {
					authErrors.push('Local credentials is null.');
					//Log.sendLog('Local credentials is null.')
					return false;
				} else {
					var json = {'access_token': _accessToken, 'refresh_token': _refreshToken, 'expires_in': 0}
					updateStorage(json, false)
				}
			}
			if (expires - 600 < new Date().getTime()/1000) {
				console.log("Try to refresh token");
				authErrors.push('Expires. Try to refresh token');
				Log.sendLog('Expires. Try to refresh token.')
				return handleRefresh();
			}
			API.setToken(_accessToken)
			var xhr = API.checkAuth();
			console.log(xhr);
			// xhr.onerror = function() {
			// 	console.log(xhr.responseText);
			// 	authErrors.push('checkAuth status: ' + xhr.status + ' ' + xhr.responseText);
			// }
			var json = Utils.parseJSON(xhr, { status: 0 });
			if (xhr.status == 401 || json.status == 401) {
				authErrors.push('Token a status: ' + xhr.status + ' ' + xhr.responseText);
				Log.sendLog('Token a status: ' + xhr.status + ' ' + xhr.responseText)
			} else { return true; }
			
			return handleRefresh();
		},
	
		accessToken(code, callback) {
			API.getDeviceToken(code, function(xhr) {
				if (xhr.status == 200) {
					var json = Utils.parseJSON(xhr);
					if (!json || !json.access_token) { callback(false, true); return; }
					updateStorage(json);
					API.setToken(json.access_token);
					callback(true, false);
				} else if (xhr.status == 400) {
					if (xhr.responseText.indexOf("authorization_pending") >= 0) {
						console.log("Waiting for activation");
						callback(false, true);
					} else {
						console.log("ActivationResponse 400", xhr.responseText);
						callback(false, false);
					}
				} else {
					console.log("ActivationResponse else", xhr);
					//callback(false, false);
				}
			});
		}
	}
}());