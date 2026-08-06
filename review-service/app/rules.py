import re
from collections.abc import Iterable
from urllib.parse import urlparse


URL_RE = re.compile(r"https?://[^\s]+", re.I)
X_STATUS_RE = re.compile(
    r"https?://(?:www\.)?(?:x\.com|twitter\.com)/([^/]+)/status/(\d+)", re.I
)
LOW_VALUE_RE = re.compile(
    r"^(?:g+m+|g+n+|gm+\s*(?:fam|everyone|all)?|gn+\s*(?:fam|everyone|all)?|"
    r"hi+|hello+|hey+|thanks?|thank\s+you|lol+|lmao+|nice|great|good|cool|"
    r"早安|早上好|晚安|你好|谢谢|哈哈+)[!！,.，。\s]*$",
    re.I,
)
EMOJI_OR_PUNCT_RE = re.compile(r"^[\W_]+$", re.UNICODE)


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def text_without_urls(value: str) -> str:
    return normalize_text(URL_RE.sub("", value))


def activity_rule_check(content: str) -> tuple[bool, list[str]]:
    text = normalize_text(content)
    flags: list[str] = []
    meaningful = text_without_urls(text)
    if not text:
        flags.append("empty")
    if LOW_VALUE_RE.fullmatch(text):
        flags.append("greeting_or_low_value")
    if len(meaningful) < 12:
        flags.append("too_short")
    if not meaningful or EMOJI_OR_PUNCT_RE.fullmatch(meaningful):
        flags.append("link_or_emoji_only")
    if len(set(meaningful.lower().split())) <= 1 and len(meaningful) < 24:
        flags.append("no_substance")
    return not flags, flags


def duplicate_flags(text: str, recent: Iterable[str]) -> list[str]:
    normalized = normalize_text(text).lower()
    if not normalized:
        return []
    for item in recent:
        other = normalize_text(item).lower()
        if normalized == other:
            return ["exact_duplicate"]
        if len(normalized) >= 80 and (normalized in other or other in normalized):
            return ["near_duplicate"]
    return []


def urls_in(text: str) -> list[str]:
    return URL_RE.findall(text or "")


def is_http_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def parse_x_status_url(value: str | None) -> tuple[str, str] | None:
    if not value:
        return None
    match = X_STATUS_RE.search(value)
    return (match.group(1).lower(), match.group(2)) if match else None
