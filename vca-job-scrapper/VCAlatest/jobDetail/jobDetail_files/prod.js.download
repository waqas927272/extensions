const CHATBOT_CONFIGURATIONS_DDO = "getChatbotConfigurations";
const ENVIRONMENT = "prod-us";
const EXPERIENCE_TYPE = "cx";
window.chatbotBaseUrl = window.chatbotBaseUrl || window.chatbotURL || window.location.href;
window.chatbotURL = window.chatbotBaseUrl || window.chatbotURL;

function getTriggerURL(environment) {
	const timestamp = new Date().getTime();
	return "https://cdn-bot.phenompeople.com/chatbot-builds/" + environment + "/initiators/" + EXPERIENCE_TYPE + "/chatbot-trigger.js?v=" + timestamp;
}

const maxRetryCount = 20;
let retryCount = 0;

function checkDependencies() {
	return window.phApp && window.phApp.phb && window.phApp.phb.profileLoginService && window.phApp.refNum;
}

function decideAndInjectChatbotTrigger() {
	const script = document.createElement("script");
	script.id = "ChatbotScriptTrigger";

	// If all dependencies are loaded, proceed with chatbot
	if (checkDependencies()) {
		window.phApp.phb.profileLoginService.fetchRequest(CHATBOT_CONFIGURATIONS_DDO, { currentUrlPath: window.location.href }, function(configurations) {
			if (!configurations || !configurations.data || configurations.statusCode !== 200) {
				console.info("Configurations Not found");
				return;
			}
			if (!configurations.data.isChannelEnabled) {
				console.info("Chatbot is disabled!!");
				return;
			}
			if (configurations.data.chatbotDisabledPageNames && Array.isArray(configurations.data.chatbotDisabledPageNames) && configurations.data.chatbotDisabledPageNames.includes(window.phApp.pageName)) {
				console.info("Chatbot is disabled on this page");
				return;
			}
			window.phChatbot = window.phChatbot || {};
			window.phChatbot.configurations = configurations;
			const triggerURL = getTriggerURL(ENVIRONMENT);
			script.src = triggerURL;
			document.body.appendChild(script);
		});
		return;
	}

	// If phApp exists but other dependencies aren't ready, retry
	if (window.phApp) {
		if (retryCount < maxRetryCount) {
			setTimeout(() => {
				decideAndInjectChatbotTrigger();
			}, 200);
			retryCount++;
			return;
		}
		console.error("Chatbot not injected, as Required dependent scripts not injected after " + maxRetryCount + " retries");
		return;
	}

	// If no phApp, inject without configurations
	const triggerURL = getTriggerURL(ENVIRONMENT);
	script.src = triggerURL;
	setTimeout(() => {
		document.body.appendChild(script);
	}, 200);
}

if (window.phApp && (document.readyState === "complete" || document.readyState === "interactive")) {
	decideAndInjectChatbotTrigger();
} else if (window.phApp) {
	window.addEventListener("load", () => {
		decideAndInjectChatbotTrigger();
	});
} else {
	decideAndInjectChatbotTrigger();
}
