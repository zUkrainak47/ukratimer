// Add new entries at the top. The first entry is treated as the latest update
// and drives the unread indicator in Settings.
// Keep each id stable once released; changing it will mark the entry unread again.
function freezeChangelogEntry(entry) {
    const items = Array.isArray(entry?.items)
        ? entry.items.map((item) => String(item || '').trim()).filter(Boolean)
        : [];

    return Object.freeze({
        id: String(entry?.id || '').trim(),
        date: String(entry?.date || '').trim(),
        title: String(entry?.title || '').trim(),
        summary: String(entry?.summary || '').trim(),
        items: Object.freeze(items),
    });
}

export const CHANGELOG_ENTRIES = Object.freeze([
    {
        id: '2026-05-21-merge',
        date: '2026-05-21',
        title: 'Auto Export, Merge Import',
        items: [
            'Added Auto Export at Settings > Data',
            'Added Merge Import. Imported backups can now preserve local solves that are not in the backup. You can still overwrite the local save',
        ]
    },

    {
        id: '2026-05-18-session-settings',
        date: '2026-05-18',
        title: 'Per-session Settings',
        items: [
            'Added Global / Session setting scopes. You can now keep things like inspection, theme, or timer behavior session-specific.',
            'Fixed online battle rooms sometimes clearing battle stats for everyone in the room',
        ]
    },

    {
        id: '2026-05-15-batch-scrambles',
        date: '2026-05-15',
        title: 'Batch Scramble Generation',
        summary: 'Added Batch Scramble Generation at Settings > Tools'
    },

    {
        id: '2026-05-12-persistent-login',
        date: '2026-05-12',
        title: 'Persistent Google Login',
        summary: 'You will no longer get logged out of your Google account every hour!'
    },

    {
        id: '2026-05-11-online-battle',
        date: '2026-05-11',
        title: 'Online Battles & more',
        items: [
            'Added Online Battles at Settings > Tools',
            'Added Cumulative Mode toggle to the time distribution graph (first button under the time trend)',
            'Added a helpful description to tooltips, previously they would just show the keyboard shortcut',
            'Minor adjustments'
        ],
    },

    {
        id: '2026-04-26-stackmat',
        date: '2026-04-26',
        title: 'Bluetooth/Stackmat, Camera Background, Reminders',
        items: [
            'Now supporting Bluetooth/Stackmat timer input',
            'Added built-in Camera Background. Now you don\'t need a custom OBS theme to show your camera and stats',
            'Added Reminders to do a backup every 100 solves at Settings > Data',
        ],
    },

    {
        id: '2026-04-18-streak',
        date: '2026-04-18',
        title: 'Daily Streak',
        summary: 'Added Daily Streak at Settings > Stats'
    },


].map(freezeChangelogEntry));

export const LATEST_CHANGELOG_ENTRY_ID = CHANGELOG_ENTRIES[0]?.id || '';
