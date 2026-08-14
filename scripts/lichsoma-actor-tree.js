function escapeHtml(value) {
    const text = String(value ?? '');
    return foundry?.utils?.escapeHTML ? foundry.utils.escapeHTML(text) : text;
}

export function getFolderParentId(folder) {
    if (!folder) return null;

    const normalizeId = (value) => {
        if (!value) return null;
        if (typeof value === 'string') return value;
        return value.id || value._id || null;
    };

    try {
        const embeddedFolder = normalizeId(folder.folder);
        if (embeddedFolder && embeddedFolder !== folder.id) return embeddedFolder;

        const documentParent = normalizeId(folder.document?.parent);
        if (documentParent && documentParent !== folder.id) return documentParent;

        const dataParent = normalizeId(folder.data?.parent);
        if (dataParent && dataParent !== folder.id) return dataParent;

        const directParent = normalizeId(folder.parent);
        if (directParent && directParent !== folder.id) return directParent;
    } catch (_error) {
        return null;
    }
    return null;
}

export function getFolderPath(folder) {
    if (!folder) return '';

    const parts = [];
    const seen = new Set();
    let current = folder;

    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        parts.unshift(current.name);
        const parentId = getFolderParentId(current);
        current = parentId ? game.folders.get(parentId) : null;
    }

    return parts.join(' / ');
}

function getAllFolders() {
    try {
        if (Array.isArray(game.folders?.contents)) return game.folders.contents;
        if (typeof game.folders?.filter === 'function') return game.folders.filter(() => true);
        if (typeof game.folders?.values === 'function') return Array.from(game.folders.values());
        return Object.values(game.folders || {});
    } catch (_error) {
        return [];
    }
}

export function getAccessibleActors(searchTerm = '') {
    let actors = game.actors.filter((actor) => (
        game.user.isGM
        || actor.isOwner
        || actor.testUserPermission(game.user, 'OWNER')
        || actor.testUserPermission(game.user, 'LIMITED')
        || actor.testUserPermission(game.user, 'OBSERVER')
    ));

    const hasTaskbarModule = game.modules.get('lichsoma-taskbar')?.active === true;
    const normalizedSearch = String(searchTerm || '').trim().toLowerCase();

    if (normalizedSearch) {
        actors = actors.filter((actor) => {
            if (String(actor.name || '').toLowerCase().includes(normalizedSearch)) return true;
            if (!hasTaskbarModule) return false;

            const tags = actor.getFlag('lichsoma-taskbar', 'tags') || [];
            return Array.isArray(tags) && tags.some((tag) => String(tag).toLowerCase().includes(normalizedSearch));
        });
    }

    return { actors, hasTaskbarModule };
}

export function buildActorFolderTree(actors) {
    const folderMap = new Map();
    const noFolderActors = [];
    const relevantFolderIds = new Set();

    for (const actor of actors) {
        if (actor.folder) relevantFolderIds.add(actor.folder.id);
        else noFolderActors.push(actor);
    }

    const processed = new Set();
    const queue = new Set(relevantFolderIds);
    while (queue.size) {
        const batch = Array.from(queue);
        queue.clear();

        for (const folderId of batch) {
            if (processed.has(folderId)) continue;
            const folder = game.folders.get(folderId);
            if (!folder) continue;

            processed.add(folderId);
            relevantFolderIds.add(folderId);
            const parentId = getFolderParentId(folder);
            if (parentId && !processed.has(parentId)) queue.add(parentId);
        }
    }

    for (const folderId of relevantFolderIds) {
        const folder = game.folders.get(folderId);
        if (!folder) continue;
        folderMap.set(folderId, {
            folder,
            folderPath: getFolderPath(folder),
            directActors: [],
            subFolders: new Set()
        });
    }

    for (const actor of actors) {
        const folderId = actor.folder?.id;
        if (folderId && folderMap.has(folderId)) {
            folderMap.get(folderId).directActors.push(actor);
        }
    }

    for (const folder of getAllFolders()) {
        if (!folderMap.has(folder.id)) continue;
        const parentId = getFolderParentId(folder);
        if (parentId && folderMap.has(parentId)) {
            folderMap.get(parentId).subFolders.add(folder.id);
        }
    }

    const rootFolderIds = Array.from(folderMap.entries())
        .filter(([folderId, data]) => {
            const parentId = getFolderParentId(data.folder);
            return !parentId || !folderMap.has(parentId) || parentId === folderId;
        })
        .sort((a, b) => String(a[1].folder.name || '').localeCompare(String(b[1].folder.name || '')))
        .map(([folderId]) => folderId);

    return { folderMap, noFolderActors, rootFolderIds };
}

export function renderActorFolderTree({
    folderMap,
    rootFolderIds,
    noFolderActors,
    folderStates = new Map(),
    renderActor,
    noFolderLabel = 'No Folder'
}) {
    const renderFolder = (folderId, level = 0) => {
        const data = folderMap.get(folderId);
        if (!data) return '';

        const expanded = folderStates.has(folderId) ? folderStates.get(folderId) : true;
        const icon = expanded ? 'fa-folder-open' : 'fa-folder';
        const directActors = [...data.directActors].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        const subFolderIds = [...data.subFolders];

        let html = `
            <div class="lichsoma-folder-section" style="margin-left: ${level}px;">
                <div class="lichsoma-folder-header" title="${escapeHtml(data.folderPath)}" data-folder-id="${folderId}">
                    <i class="fas ${icon}"></i>
                    <span>${escapeHtml(data.folder.name)}</span>
                    <span class="lichsoma-folder-count">(${directActors.length})</span>
                </div>
                <div class="lichsoma-folder-actors" style="display: ${expanded ? 'block' : 'none'}">
        `;

        for (const actor of directActors) html += renderActor(actor);
        for (const subFolderId of subFolderIds) html += renderFolder(subFolderId, level + 1);

        html += `
                </div>
            </div>
        `;
        return html;
    };

    let html = '';
    for (const folderId of rootFolderIds) html += renderFolder(folderId, 0);

    if (noFolderActors.length) {
        const actors = [...noFolderActors].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
        html += `
            <div class="lichsoma-folder-section">
                <div class="lichsoma-folder-header">
                    <i class="fas fa-question-circle"></i>
                    <span>${escapeHtml(noFolderLabel)}</span>
                    <span class="lichsoma-folder-count">(${actors.length})</span>
                </div>
                <div class="lichsoma-folder-actors">
        `;
        for (const actor of actors) html += renderActor(actor);
        html += `
                </div>
            </div>
        `;
    }

    return html;
}
