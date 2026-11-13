import { SpeakerSelectorCompat } from './lichsoma-speaker-selector-compat.js';

const MODULE_ID = 'lichsoma-speaker-selector';

export class SpeakerSelectorSettingCSSEditor extends SpeakerSelectorCompat.ApplicationV2 {
    static settingKey = 'chatLogExportCustomCSS';
    static titleKey = 'SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Name';
    static savedKey = 'SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Saved';
    static defaultId = 'lichsoma-chat-log-export-css-editor';

    static DEFAULT_OPTIONS = {
        id: 'lichsoma-chat-log-export-css-editor',
        classes: ['lichsoma-css-editor'],
        tag: 'div',
        window: {
            frame: true,
            positioned: true,
            title: 'SPEAKERSELECTOR.Settings.ChatLogExportCustomCSS.Name',
            resizable: true,
            minimizable: false,
            contentClasses: []
        },
        position: {
            width: 800,
            height: 600
        }
    };

    editor = null;
    _resizeObserver = null;

    constructor(options = {}) {
        const cls = new.target;
        const baseOptions = foundry.utils.mergeObject(cls.DEFAULT_OPTIONS, {
            id: cls.defaultId,
            window: { title: cls.titleKey }
        }, { inplace: false });
        super(foundry.utils.mergeObject(baseOptions, options, { inplace: false }));
    }

    async _prepareContext(options) {
        const css = game.settings.get(MODULE_ID, this.constructor.settingKey) || '';
        return { css };
    }

    async _renderHTML(context, options) {
        const html = await SpeakerSelectorCompat.renderTemplate(
            `modules/${MODULE_ID}/templates/css-editor.html`,
            context
        );
        const wrap = document.createElement('div');
        wrap.innerHTML = html.trim();
        return wrap.firstElementChild ?? wrap;
    }

    _replaceHTML(result, content, options) {
        content.replaceChildren(result);
    }

    async _onFirstRender(context, options) {
        const form = this.element.querySelector('form.lichsoma-css-editor-form');
        if (!form) return;

        const textarea = form.querySelector('textarea[name="css"]');
        if (!textarea) return;

        const CodeMirrorClass = window.CodeMirror || CONFIG.CM?.CodeMirror;
        if (!CodeMirrorClass) {
            this.editor = null;
        } else {
            const editor = CodeMirrorClass.fromTextArea(textarea, {
                mode: 'css',
                theme: 'foundry',
                lineNumbers: true,
                indentUnit: 2,
                tabSize: 2,
                lineWrapping: true,
                autofocus: true,
                extraKeys: {
                    'Ctrl-S': () => void this._onSave(),
                    'Cmd-S': () => void this._onSave()
                }
            });
            this.editor = editor;

            this._resizeObserver = new ResizeObserver(() => {
                if (this.editor) setTimeout(() => this.editor.refresh(), 100);
            });
            this._resizeObserver.observe(this.element);
        }

        form.querySelector('.save-css')?.addEventListener('click', (event) => {
            event.preventDefault();
            void this._onSave();
        });
        form.querySelector('.cancel-css')?.addEventListener('click', (event) => {
            event.preventDefault();
            void this.close();
        });
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            void this._onSave();
        });
    }

    async _onClose(options) {
        if (this._resizeObserver) {
            this._resizeObserver.disconnect();
            this._resizeObserver = null;
        }
        if (this.editor) {
            try {
                this.editor.toTextArea();
            } catch (_) {
                /* noop */
            }
            this.editor = null;
        }
    }

    async _onSave() {
        try {
            let css = '';
            if (this.editor) css = this.editor.getValue();
            else css = this.element.querySelector('textarea[name="css"]')?.value ?? '';

            await game.settings.set(MODULE_ID, this.constructor.settingKey, css);
            ui.notifications.info(game.i18n.localize(this.constructor.savedKey));
            await this.close();
        } catch (error) {
            ui.notifications.error(game.i18n.format('SPEAKERSELECTOR.Notifications.CssSaveFailed', { error: error.message }));
        }
    }
}

export function createCssSettingEditorClass({ settingKey, titleKey, savedKey, defaultId }) {
    return class extends SpeakerSelectorSettingCSSEditor {
        static settingKey = settingKey;
        static titleKey = titleKey;
        static savedKey = savedKey;
        static defaultId = defaultId;
    };
}
