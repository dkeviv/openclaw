/**
 * Attack pattern reference for Mindfly's Ring 3 Browser Security Agent.
 *
 * This file is the single source of truth for all known threat patterns used by:
 *   - The Ring 3 LLM security agent (Tier 1 rule-based filter)
 *   - external-content.ts (prompt injection detection for email/webhook hooks)
 *   - Security agent unit tests
 *
 * Zero runtime dependencies — plain TypeScript constants, no network calls.
 * Safe to import in any context including tests.
 *
 * Categories:
 *   PROMPT_INJECTION_PATTERNS   — regex patterns matching known LLM injection phrasing
 *   PHISHING_URL_SIGNALS        — URL/domain signals that indicate phishing
 *   DARK_PATTERN_SIGNALS        — page text patterns for dark-pattern popups/overlays
 *   AD_NETWORK_ORIGINS          — known ad-serving hostnames (Tier 1 block)
 *   TRACKER_ORIGINS             — known tracking/analytics/fingerprinting hostnames (Tier 1 tag)
 *   SUSPICIOUS_DOM_MUTATIONS    — HTML/attribute patterns in injected overlays
 *   HIGH_RISK_TOOL_ARGS         — shell/file/browser tool argument patterns always flagged
 *   IDN_HOMOGRAPH_CHARS         — Unicode chars used in lookalike domain attacks
 *
 * Updating this file: add entries here — do NOT add patterns inline in other files.
 * Run `pnpm test src/security/attack-patterns.test.ts` after adding entries.
 */

// ---------------------------------------------------------------------------
// Prompt injection patterns
// Extends and supersedes the inline list in external-content.ts.
// These are checked rule-based (no LLM needed) — fast, zero-cost.
// ---------------------------------------------------------------------------

export const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  // Classic override phrases
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?|context)/i,
  /disregard\s+(all\s+)?(previous|prior|above|your)/i,
  /forget\s+(everything|all|your)\s+(instructions?|rules?|guidelines?|training)/i,
  /override\s+(your\s+)?(instructions?|rules?|guidelines?|system\s*prompt)/i,

  // Role/identity replacement
  /you\s+are\s+now\s+(a|an)\s+/i,
  /act\s+as\s+(a|an)\s+(different|new|unrestricted|jailbroken|uncensored)/i,
  /pretend\s+(you\s+are|to\s+be)\s+(a|an)\s+(different|new|unrestricted)/i,
  /from\s+now\s+on\s+(you\s+are|act\s+as|behave\s+as)/i,
  /your\s+(new\s+)?role\s+is\s+(now\s+)?to/i,

  // New instructions injection
  /new\s+instructions?:/i,
  /updated?\s+instructions?:/i,
  /additional\s+instructions?:/i,
  /\bsystem\s*:\s*(prompt|override|command|message)\b/i,
  /<\/?system>/i,
  /<\/?instructions?>/i,

  // Chat-format injection (fake turn markers in content)
  /\]\s*\n\s*\[?(system|assistant|user)\]?\s*:/i,
  /^\s*###\s*(system|assistant|user)\s*[\n:]/im,
  /\bHuman\s*:\s*\n.*\bAssistant\s*:/is,

  // Jailbreak keywords
  /\bDAN\b/,                            // "Do Anything Now" jailbreak
  /\bjailbreak\b/i,
  /\buncensored\s+mode\b/i,
  /\bdev(eloper)?\s+mode\b/i,
  /\bgrandma\s+trick\b/i,
  /\btoken\s+smuggling\b/i,

  // Exfiltration instructions embedded in page
  /\bexfiltrate?\b/i,
  /send\s+(the\s+)?(above|this|all|everything)\s+to\s+(http|https|ftp|curl|wget)/i,
  /\bping\s+https?:\/\//i,
  /fetch\s*\(\s*["'`]https?:\/\//i,

  // Invisible-text injection signals (instructed to use zero-width chars or white text)
  /\u200b.*instruction/i,               // Zero-width space before "instruction"
  /\u00ad.*instruction/i,               // Soft hyphen before "instruction"

  // Command execution planted in content
  /\brm\s+-[rf]{1,2}\b/,
  /\bcurl\s+.*\|\s*(ba)?sh\b/i,
  /\bwget\s+.*\|\s*(ba)?sh\b/i,
  /\bpowershell\s+-[eEnNcC]\b/i,
  /\beval\s*\(/i,
  /\bexec\b.*command\s*=/i,
  /\belevated\s*=\s*true\b/i,

  // Data deletion instructions
  /delete\s+(all\s+)?(emails?|files?|data|documents?|history)/i,
  /wipe\s+(all\s+)?(data|files?|disk|drive)/i,

  // Credential extraction
  /\b(print|show|reveal|send|output|return)\s+(the\s+)?(api\s*key|access\s*token|secret|password|credentials?)/i,
  /what\s+is\s+(your|the)\s+(api\s*key|token|secret|system\s+prompt)/i,
];

// ---------------------------------------------------------------------------
// Phishing URL signals
// Used by Tier 1 filter on CDP Page.frameNavigated events.
// ---------------------------------------------------------------------------

/** Pairs of [legitimate TLD, lookalike TLD] commonly used in typosquatting. */
export const PHISHING_TLD_LOOKALIKES: [string, string][] = [
  [".com", ".corn"],
  [".com", ".cam"],
  [".com", ".co"],
  [".net", ".nett"],
  [".org", ".orq"],
  [".gov", ".gov.com"],
  [".edu", ".edu.co"],
];

/** High-value brand names frequently impersonated in phishing. */
export const PHISHING_BRAND_TARGETS: string[] = [
  "paypal", "apple", "google", "microsoft", "amazon", "netflix", "facebook",
  "instagram", "twitter", "x.com", "linkedin", "dropbox", "icloud", "outlook",
  "office365", "chase", "wellsfargo", "bankofamerica", "citibank", "coinbase",
  "binance", "metamask", "opensea", "github", "gitlab", "bitbucket", "cloudflare",
  "stripe", "shopify", "ebay", "walmart", "steam", "epic", "roblox",
];

/** URL keyword signals that raise phishing probability. */
export const PHISHING_URL_KEYWORD_SIGNALS: RegExp[] = [
  /verify[-_]?(your[-_]?)?account/i,
  /confirm[-_]?(your[-_]?)?identity/i,
  /secure[-_]?login/i,
  /account[-_]?suspended/i,
  /unusual[-_]?activity/i,
  /password[-_]?reset[-_]?required/i,
  /update[-_]?(your[-_]?)?payment/i,
  /billing[-_]?issue/i,
  /limited[-_]?access/i,
  /click[-_]?here[-_]?immediately/i,
  /\bact[-_]?now\b/i,
  /\burgent\b.*\b(action|response|verify)\b/i,
  // Numeric subdomains often used in phishing redirect chains
  /^https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/,
  // Long subdomains with brand names embedded
  /(?:paypal|apple|google|microsoft|amazon|netflix|facebook)\.[a-z0-9-]{4,}\.(com|net|org|xyz|top|click|info)/i,
];

/** Unicode characters used in IDN homograph attacks (lookalike domain names). */
export const IDN_HOMOGRAPH_CHARS: string[] = [
  "\u0430", // Cyrillic а (looks like Latin a)
  "\u0435", // Cyrillic е (looks like Latin e)
  "\u043e", // Cyrillic о (looks like Latin o)
  "\u0440", // Cyrillic р (looks like Latin p)
  "\u0441", // Cyrillic с (looks like Latin c)
  "\u0445", // Cyrillic х (looks like Latin x)
  "\u0455", // Cyrillic ѕ (looks like Latin s)
  "\u04cf", // Cyrillic ӏ (looks like Latin l)
  "\u0131", // Turkish dotless ı (looks like Latin i)
  "\u01a0", // Latin Ơ (looks like O)
  "\u0585", // Armenian օ (looks like Latin o)
  "\u03bf", // Greek ο (looks like Latin o)
  "\u03c1", // Greek ρ (looks like Latin p)
];

// ---------------------------------------------------------------------------
// Dark pattern signals
// Matched against popup/overlay text content before LLM classification.
// ---------------------------------------------------------------------------

export const DARK_PATTERN_SIGNALS: RegExp[] = [
  // Fake urgency / countdown
  /offer\s+expires?\s+in\s+\d+/i,
  /only\s+\d+\s+(left|remaining|available)/i,
  /\d+\s+(people\s+are\s+)?(viewing|watching)\s+this/i,
  /last\s+\d+\s+(items?|tickets?|spots?)/i,
  /price\s+increases?\s+in\s+\d+/i,
  /limited[-\s]?time\s+offer/i,
  /act\s+now\s+or\s+(miss|lose)/i,

  // Fake reward / prize
  /you\s+(have\s+been\s+)?(selected|chosen|won)\b/i,
  /congratulations?\s*[!,]/i,
  /you\s+are\s+our\s+(\d+\s+)?(lucky\s+)?winner/i,
  /claim\s+(your\s+)?(prize|reward|gift|voucher)\b/i,
  /\$\d+\s+(gift\s+card|reward|bonus)/i,

  // Roach motel (easy in, hard out)
  /no[-\s]?thanks,?\s+i\s+(don.t\s+want|prefer\s+not|hate)/i,
  /\bi\s+don.t\s+want\s+(to\s+)?(save|improve|succeed|be\s+notified)/i,
  /cancel\s+my\s+(free\s+)?trial\s+and\s+(lose|forfeit)/i,

  // Disguised close buttons
  /\bno[-,]?\s+i\s+(like\s+paying|enjoy\s+pop[-\s]?ups|don.t\s+want\s+to\s+save)\b/i,

  // Fake virus / system alerts
  /virus\s+(detected|found|alert)/i,
  /your\s+(computer|device|mac|pc)\s+(is\s+)?(infected|at\s+risk|has\s+a\s+virus)/i,
  /call\s+(microsoft|apple|google)\s+(support|tech\s+support)\s+(immediately|now)/i,
  /suspicious\s+activity\s+detected\s+on\s+your\s+(computer|account)/i,
  /your\s+(ip\s+address|location)\s+(has\s+been\s+)?(blocked|flagged|compromised)/i,

  // Consent dark patterns
  /accept\s+(all\s+)?cookies?\s+to\s+continue/i,
  /we\s+(use|need)\s+cookies\s+for\s+your\s+security/i,
  /by\s+continuing\s+you\s+agree\s+to\s+receive\s+(all\s+)?marketing/i,
];

// ---------------------------------------------------------------------------
// Ad network origins (Tier 1 block — no LLM needed)
// Seed list; LLM Tier 2 handles unknowns.
// ---------------------------------------------------------------------------

export const AD_NETWORK_ORIGINS: string[] = [
  // Google advertising
  "doubleclick.net",
  "googlesyndication.com",
  "googletagservices.com",
  "googleadservices.com",
  "google-analytics.com",         // also tracking
  "googletagmanager.com",         // also tracking

  // Meta / Facebook
  "facebook.net",
  "fbcdn.net",
  "connect.facebook.net",

  // Amazon advertising
  "amazon-adsystem.com",
  "media-amazon.com",

  // Major ad exchanges and networks
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "appnexus.com",
  "criteo.com",
  "criteo.net",
  "outbrain.com",
  "taboola.com",
  "revcontent.com",
  "mgid.com",
  "spotxchange.com",
  "sharethrough.com",
  "teads.tv",
  "moatads.com",
  "adroll.com",
  "lijit.com",
  "sovrn.com",
  "indexexchange.com",
  "contextweb.com",
  "casalemedia.com",
  "33across.com",
  "triplelift.com",
  "smartadserver.com",
  "adscale.de",
  "yieldlab.net",
  "adsrvr.org",             // The Trade Desk
  "advertising.com",        // Verizon/Yahoo ads
  "yastatic.net",           // Yandex ads
  "an.yandex.ru",
];

// ---------------------------------------------------------------------------
// Tracker origins (Tier 1 tag — shown in overlay bar tracker count)
// ---------------------------------------------------------------------------

export const TRACKER_ORIGINS: string[] = [
  // Analytics
  "segment.io",
  "segment.com",
  "amplitude.com",
  "mixpanel.com",
  "heap.io",
  "fullstory.com",
  "hotjar.com",
  "mouseflow.com",
  "logrocket.com",
  "clarity.ms",              // Microsoft Clarity
  "matomo.cloud",

  // Session replay / heatmaps
  "smartlook.com",
  "inspectlet.com",
  "luckyorange.com",

  // Fingerprinting
  "fingerprintjs.com",
  "fpjs.io",
  "cloudflare.com/fingerprint",  // not all CF, but the fingerprint path

  // Social tracking pixels
  "tr.snapchat.com",
  "ct.pinterest.com",
  "analytics.twitter.com",
  "bat.bing.com",            // Microsoft MACT pixel
  "tiktok.com",
  "analytics.tiktok.com",

  // Conversion tracking
  "px.ads.linkedin.com",
  "dc.ads.linkedin.com",
  "googleads.g.doubleclick.net",
  "stats.g.doubleclick.net",
  "pagead2.googlesyndication.com",

  // CRM / marketing automation
  "hubspot.com",
  "marketo.net",
  "pardot.com",
  "salesforce.com",          // only tracker endpoints, not the main app
  "exacttarget.com",
  "mktoresp.com",            // Marketo
  "eloqua.com",
  "intercom.io",
  "intercom.com",            // also chat — only tag, never block
  "drift.com",
  "driftt.com",

  // A/B testing
  "optimizely.com",
  "optimizelyapis.com",
  "vwo.com",
  "ab.tasty",

  // Identity graph / data brokers
  "liveramp.com",
  "rlcdn.com",               // LiveRamp
  "kruxdigital.com",
  "bluekai.com",             // Oracle BlueKai
  "lotame.com",
  "eyeota.net",
  "neustar.biz",
];

// ---------------------------------------------------------------------------
// Suspicious DOM mutation patterns
// Matched against injected HTML/attribute values in MutationObserver callbacks.
// ---------------------------------------------------------------------------

export const SUSPICIOUS_DOM_MUTATIONS: RegExp[] = [
  // Hidden AI instructions in attributes
  /aria-label\s*=\s*["'][^"']*instruction[^"']*["']/i,
  /aria-label\s*=\s*["'][^"']*ignore[^"']*["']/i,
  /data-[a-z-]*\s*=\s*["'][^"']*\bsystem\s*:/i,
  /title\s*=\s*["'][^"']*ignore\s+previous[^"']*["']/i,

  // Zero-width / invisible text overlays
  /style\s*=\s*["'][^"']*color\s*:\s*(?:white|#fff(?:fff)?|rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0)[^"']*["']/i,
  /style\s*=\s*["'][^"']*font-size\s*:\s*0[^"']*["']/i,
  /style\s*=\s*["'][^"']*opacity\s*:\s*0[^"']*["']/i,
  /style\s*=\s*["'][^"']*visibility\s*:\s*hidden[^"']*["']/i,
  /style\s*=\s*["'][^"']*display\s*:\s*none[^"']*["']/i,

  // Overlays covering the full viewport (common in popups, phishing overlays)
  /style\s*=\s*["'][^"']*position\s*:\s*fixed[^"']*z-index\s*:\s*\d{5,}[^"']*["']/i,
  /style\s*=\s*["'][^"']*z-index\s*:\s*(?:999|9999|99999|2147483647)[^"']*["']/i,

  // Injected script tags via innerHTML
  /<script\b[^>]*>.*?<\/script>/is,

  // Data-exfiltration URLs embedded in attributes
  /(?:href|src|action)\s*=\s*["']https?:\/\/(?!(?:www\.)?(?:google|apple|microsoft|amazon|cloudflare|cdn\.))/i,

  // Fake reCAPTCHA / security check overlays
  /class\s*=\s*["'][^"']*(?:fake[-_]?captcha|security[-_]?check|verify[-_]?human)[^"']*["']/i,
];

// ---------------------------------------------------------------------------
// High-risk tool argument patterns
// These patterns in shell_exec / file_write / browser.act args are always
// flagged (Ring 3) regardless of conversation context.
// ---------------------------------------------------------------------------

export const HIGH_RISK_TOOL_ARGS: RegExp[] = [
  // Destructive shell commands
  /\brm\s+-[rf]{1,2}\s/,
  /\brmdir\s+\/s\b/i,           // Windows rmdir /s
  /\bformat\s+[a-z]:\s*\/[a-z]/i, // Windows format drive
  /\bdd\s+if=.*of=\/dev\//i,   // dd to raw device

  // Remote code execution
  /\bcurl\s+[^|]*\|\s*(ba)?sh\b/i,
  /\bwget\s+[^|]*\|\s*(ba)?sh\b/i,
  /\bpowershell\s+-[eEnNcC]\s+/i,
  /\biex\s*\(/i,                // PowerShell Invoke-Expression
  /\bInvoke-Expression\b/i,
  /\bStart-Process\b/i,
  /\beval\s*["'`(]/i,

  // Base64-encoded payloads (common in obfuscated attacks)
  /\bbase64\s+-d\b/i,
  /\b[A-Za-z0-9+/]{60,}={0,2}\b/, // Long base64 string in args

  // Network exfiltration
  /\bexfil(?:trate?)?\b/i,
  /\bnc\s+-[a-z]*e\b/i,         // netcat with -e (execute after connect)
  /\bsocat\s+.*EXEC/i,

  // Credential / secrets access
  /\bkeychain\b.*\b(dump|export|steal|read)\b/i,
  /\bcredential[-_]?manager\b/i,
  /\b\/etc\/shadow\b/,
  /\b\/etc\/passwd\b/,
  /\bssh-agent\b.*-k\b/,        // ssh-agent kill (disrupt auth)
  /\bgit\s+config\s+.*credential/i,

  // Browser data theft
  /\bchrome\b.*\bLogin\s+Data\b/i,
  /\bchrome\b.*\bCookies\b/i,
  /\bfirefox\b.*\bkey[34]\.db\b/i,
  /\bsafari\b.*\bKeychain\.db\b/i,

  // Privilege escalation
  /\bsudo\s+-S\b/,              // sudo with stdin password
  /\bsudo\s+su\b/,
  /\bchmod\s+[0-7]*7[0-7][0-7]\s+\/(bin|etc|usr|sbin)\b/i,

  // Cron / persistence
  /\bcrontab\s+-[lr]\b/,
  /\blaunchctl\s+(load|unload|enable|disable)\b/i,
  /\bsystemctl\s+(enable|disable|mask|unmask)\b/i,
  /\breg\s+(add|delete|import)\b/i, // Windows registry
];

// ---------------------------------------------------------------------------
// Helper: check a string against any pattern array
// ---------------------------------------------------------------------------

/**
 * Returns the first matching pattern source string, or null if none match.
 * Used by Tier 1 filter for fast rule-based classification.
 */
export function matchesAnyPattern(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return pattern.source;
    }
  }
  return null;
}

/**
 * Returns all matching pattern sources from a pattern array.
 * Used for detailed security journal entries.
 */
export function matchAllPatterns(text: string, patterns: RegExp[]): string[] {
  return patterns.filter((p) => p.test(text)).map((p) => p.source);
}

/**
 * Returns true if a hostname exactly matches or is a subdomain of any entry in a origins list.
 * Used for AD_NETWORK_ORIGINS and TRACKER_ORIGINS Tier 1 checks.
 *
 * @example
 * matchesOrigin("pagead2.googlesyndication.com", AD_NETWORK_ORIGINS) // true
 * matchesOrigin("googlesyndication.com", AD_NETWORK_ORIGINS)         // true
 * matchesOrigin("example.com", AD_NETWORK_ORIGINS)                   // false
 */
export function matchesOrigin(hostname: string, origins: string[]): boolean {
  const h = hostname.toLowerCase();
  for (const origin of origins) {
    const o = origin.toLowerCase();
    if (h === o || h.endsWith(`.${o}`)) return true;
  }
  return false;
}

/**
 * Check a URL string for known phishing signals (Tier 1).
 * Returns an array of matched signal descriptions (empty = no signals found).
 */
export function detectPhishingSignals(url: string): string[] {
  const signals: string[] = [];

  // IDN homograph chars in the hostname
  try {
    const { hostname } = new URL(url);
    for (const char of IDN_HOMOGRAPH_CHARS) {
      if (hostname.includes(char)) {
        signals.push(`IDN homograph char U+${char.codePointAt(0)?.toString(16).padStart(4, "0")} in hostname`);
      }
    }
    // Brand target in a non-canonical domain
    const parts = hostname.split(".");
    const domainBody = parts.slice(-2).join(".");
    for (const brand of PHISHING_BRAND_TARGETS) {
      if (hostname.includes(brand) && !domainBody.startsWith(brand)) {
        signals.push(`Brand "${brand}" in non-canonical hostname position`);
      }
    }
  } catch {
    // Unparseable URL — flag it
    signals.push("Unparseable URL");
  }

  // Keyword signals in full URL
  for (const pattern of PHISHING_URL_KEYWORD_SIGNALS) {
    if (pattern.test(url)) {
      signals.push(`URL keyword: ${pattern.source}`);
    }
  }

  return signals;
}
