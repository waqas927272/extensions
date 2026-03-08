var PH_TRACKING_STATES = {
    ENABLED: 'enabled',
    DISABLED: 'disabled',
    NOT_READY: 'not_ready'
}
function PhTracking() {
    function decode(value) {
        try {
            return decodeURIComponent(value)
        } catch (e) {
            return null
        }
    }
    function getAllCookies() {
        let obj = {}
        let pairs = document.cookie.split(/ *; */)
        let pair

        if (pairs[0] === '') {
            return obj
        }

        for (let i = 0; i < pairs.length; ++i) {
            pair = pairs[i].split('=')
            obj[decode(pair[0])] = decode(pair[1])
        }

        return obj
    }
    function getCookie(cookieName) {
        let cookies = getAllCookies()
        if (cookies && cookies[cookieName]) {
            return cookies[cookieName]
        }

        return null
    }
    function shouldDisableTrackingOnCookieDecline() {
        if (phApp && phApp.ddo && phApp.ddo.siteConfig) {
            return phApp.ddo.siteConfig.data && phApp.ddo.siteConfig.data.disableTrackingOnCookieDecline;
        }
        return null;
    }
    function getCurrentTrackingState() {
        if (phApp && phApp.ddo && phApp.ddo.siteConfig) {
            var disableTrackingOnCookieDecline = shouldDisableTrackingOnCookieDecline();
            var cookieConsent = getCookie('PHPPPE_GCC')
            var disableTracking = disableTrackingOnCookieDecline && (!cookieConsent || cookieConsent === 'd')
            return disableTracking ? PH_TRACKING_STATES.DISABLED : PH_TRACKING_STATES.ENABLED;
        } else {
            return PH_TRACKING_STATES.NOT_READY;
        }
    }
    function init() {
        var script = document.createElement('script')
        script.type = 'text/javascript'
        script.async = !0
        script.src =
            'undefined' !== typeof PHENOMTRACK_URL
                ? PHENOMTRACK_URL
                : 'file:' === document.location.protocol && '//' + phApp.phenomTrackURL.match(/^\/\//)
                ? 'https://' + phApp.phenomTrackURL
                : '//' + phApp.phenomTrackURL
        var p = document.getElementsByTagName('head')[0]
        p.parentNode.insertBefore(script, p)
        script.onload = function () {
            if (phApp && phApp.ddo && phApp.ddo.siteConfig && phApp.ddo.siteConfig.data) {
                var isEventEnabled
                var siteSettings = phApp.ddo.siteConfig.data.siteSettings || {}
                var cookieMap = siteSettings.externalCookieConfig && siteSettings.externalCookieConfig.trackCookieMap
                var arcCookeMap =
                    siteSettings.externalCookieTrustArcConfig &&
                    siteSettings.externalCookieTrustArcConfig.trackCookieMap

                if (cookieMap || arcCookeMap) {
                    isEventEnabled = true
                }

                phenomevent.init(phApp.refNum, undefined, isEventEnabled, phApp.nonTxmCookieConcern)
            } else {
                phApp.trackPending = phenomevent.init
            }
        }
    }
    function postAcceptInit() {
        const disableTrackingOnCookieDecline = shouldDisableTrackingOnCookieDecline();
        if(disableTrackingOnCookieDecline) {
            const currentTrackingState = getCurrentTrackingState()
            if (currentTrackingState === PH_TRACKING_STATES.ENABLED && !window.phenomevent) {
                pendingTrackEvents = [];
                phTracking.init()
            }
        }
    }

    return {
        init: init,
        postAcceptInit: postAcceptInit,
        shouldDisableTrackingOnCookieDecline: shouldDisableTrackingOnCookieDecline,
        getCurrentTrackingState: getCurrentTrackingState,
    }
}

window.phTracking = new PhTracking()
const currentTrackingState = phTracking.getCurrentTrackingState()
if (currentTrackingState === PH_TRACKING_STATES.ENABLED) {
    phTracking.init()
}

document.addEventListener('ph:gdpr:OptanonWrapperUpdated', phTracking.postAcceptInit.bind(this))

document.addEventListener('ph:gdpr:cookie:accepted', phTracking.postAcceptInit.bind(this))
