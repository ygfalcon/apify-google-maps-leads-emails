// Strip credentials before a string can land in a log line or a dataset field.

export function redactSecrets(value) {
    return String(value ?? '')
        .replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]*):([^@\s/]+)@/gi, '$1$2:***@')
        .replace(/\b(apify_token|apify_proxy_password|proxy_password|authorization)\b(\s*[:=]\s*)\S+/gi, '$1$2***');
}
