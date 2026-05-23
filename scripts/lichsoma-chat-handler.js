/**
 * LichSOMA Chat Handler
 * 채팅 메시지에서 마크다운 스타일 포맷팅 처리
 * - 루비 문자: [[텍스트|루비]]
 * - 취소선: ~~텍스트~~
 * - 이탤릭: *텍스트*
 * - 볼드: **텍스트**
 * - 볼드+이탤릭: ***텍스트***
 *
 * v14 개선:
 * - element.innerHTML 전체 문자열 치환을 하지 않고, 텍스트 노드만 변환합니다.
 * - 주사위, 링크, 버튼, 코드 블록, 이미 생성된 포맷 요소 등은 건드리지 않습니다.
 */

export class ChatRubyHandler {
    static SKIP_SELECTOR = [
        'a',
        'button',
        'input',
        'select',
        'textarea',
        'script',
        'style',
        'code',
        'pre',
        'ruby',
        'rt',
        'b',
        'strong',
        'i',
        'em',
        's',
        'del',
        '.inline-roll',
        '.dice-roll',
        '.dice-tooltip',
        '.dice-formula',
        '.dice-total',
        '.roll',
        '.rollable',
        '[data-lichsoma-format-skip="true"]'
    ].join(',');

    /**
     * 초기화
     */
    static initialize() {
        // 채팅 메시지 렌더링 시 마크다운 포맷팅 처리
        Hooks.on('renderChatMessageHTML', (message, html, data) => {
            try {
                const root = this._asHTMLElement(html);
                if (!root) return;

                // 메시지 내용에서 포맷팅 처리
                const messageContent = root.querySelector('.message-content');
                if (messageContent) {
                    this.processFormatting(messageContent);
                }

                // 헤더(발신자 이름)에서도 포맷팅 처리
                const messageSender =
                    root.querySelector('.message-sender[data-lichsoma-sender="true"]') ||
                    root.querySelector('.message-sender');

                if (messageSender) {
                    this.processFormatting(messageSender);
                }
            } catch (e) {
                // 포맷팅 처리 중 오류 (무시)
            }
        });
    }

    /**
     * jQuery/HTMLElement 양쪽 입력을 HTMLElement로 정규화한다.
     * @param {HTMLElement|JQuery} html
     * @returns {HTMLElement|null}
     */
    static _asHTMLElement(html) {
        if (!html) return null;
        if (html instanceof HTMLElement) return html;
        if (html.jquery && html[0] instanceof HTMLElement) return html[0];
        return null;
    }

    /**
     * 모든 포맷팅 처리.
     * innerHTML 전체 치환 대신, 안전하게 텍스트 노드만 찾아 바꾼다.
     * @param {HTMLElement} element - 처리할 요소
     */
    static processFormatting(element) {
        if (!element) return;

        // 이미 처리된 요소는 건너뛰기 (중복 처리 방지)
        if (element.dataset.lichsomaFormatProcessed) return;

        try {
            const textNodes = this._collectProcessableTextNodes(element);

            for (const textNode of textNodes) {
                const text = textNode.nodeValue || '';
                if (!this._textMayNeedFormatting(text)) continue;

                const fragment = this._parseInlineToFragment(text);
                if (!fragment || !fragment.childNodes.length) continue;

                textNode.replaceWith(fragment);
            }

            // 처리 완료 표시
            element.dataset.lichsomaFormatProcessed = 'true';
        } catch (e) {
            // 포맷팅 처리 중 오류 (무시)
        }
    }

    /**
     * 포맷 처리 가능한 텍스트 노드만 수집한다.
     * TreeWalker 중간에 DOM을 수정하면 순회가 꼬일 수 있으므로 먼저 배열로 모은다.
     * @param {HTMLElement} root
     * @returns {Text[]}
     */
    static _collectProcessableTextNodes(root) {
        const nodes = [];
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node) => {
                    if (!node.nodeValue || !this._textMayNeedFormatting(node.nodeValue)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    const parent = node.parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;
                    if (parent.closest(this.SKIP_SELECTOR)) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    return NodeFilter.FILTER_ACCEPT;
                }
            }
        );

        let current;
        while ((current = walker.nextNode())) {
            nodes.push(current);
        }
        return nodes;
    }

    /**
     * @param {string} text
     * @returns {boolean}
     */
    static _textMayNeedFormatting(text) {
        return /\[\[|\*|~~/.test(text);
    }

    /**
     * 텍스트 하나를 DOM Fragment로 변환한다.
     * 지원 문법은 기존 구현과 동일하지만, 결과는 HTML 문자열이 아니라 실제 노드로 만든다.
     * @param {string} text
     * @returns {DocumentFragment}
     */
    static _parseInlineToFragment(text) {
        const fragment = document.createDocumentFragment();
        let index = 0;

        const appendText = (value) => {
            if (value) fragment.appendChild(document.createTextNode(value));
        };

        while (index < text.length) {
            const next = this._findNextMarker(text, index);
            if (!next) {
                appendText(text.slice(index));
                break;
            }

            if (next.index > index) {
                appendText(text.slice(index, next.index));
            }

            const parsed = this._parseMarkerAt(text, next.index, next.marker);
            if (!parsed) {
                appendText(next.marker);
                index = next.index + next.marker.length;
                continue;
            }

            fragment.appendChild(parsed.node);
            index = parsed.nextIndex;
        }

        return fragment;
    }

    /**
     * 현재 위치 이후 가장 가까운 마커를 찾는다.
     * 같은 위치에서는 긴 마커를 우선한다. 예: *** > ** > *
     * @param {string} text
     * @param {number} from
     * @returns {{ marker: string, index: number }|null}
     */
    static _findNextMarker(text, from) {
        const markers = ['[[', '***', '**', '~~', '*'];
        let best = null;

        for (const marker of markers) {
            const index = text.indexOf(marker, from);
            if (index === -1) continue;
            if (
                !best ||
                index < best.index ||
                (index === best.index && marker.length > best.marker.length)
            ) {
                best = { marker, index };
            }
        }

        return best;
    }

    /**
     * 지정 위치의 마커를 하나의 DOM 노드로 파싱한다.
     * 닫는 마커가 없으면 null을 반환해 원문 마커를 보존한다.
     * @param {string} text
     * @param {number} index
     * @param {string} marker
     * @returns {{ node: Node, nextIndex: number }|null}
     */
    static _parseMarkerAt(text, index, marker) {
        if (marker === '[[') {
            return this._parseRubyAt(text, index);
        }

        const close = marker;
        const contentStart = index + marker.length;
        const closeIndex = text.indexOf(close, contentStart);
        if (closeIndex === -1) return null;

        const innerText = text.slice(contentStart, closeIndex);
        if (!innerText) return null;

        let node;
        if (marker === '***') {
            const bold = document.createElement('b');
            const italic = document.createElement('i');
            italic.appendChild(this._parseInlineToFragment(innerText));
            bold.appendChild(italic);
            node = bold;
        } else if (marker === '**') {
            node = document.createElement('b');
            node.appendChild(this._parseInlineToFragment(innerText));
        } else if (marker === '~~') {
            node = document.createElement('s');
            node.appendChild(this._parseInlineToFragment(innerText));
        } else if (marker === '*') {
            node = document.createElement('i');
            node.appendChild(this._parseInlineToFragment(innerText));
        } else {
            return null;
        }

        return { node, nextIndex: closeIndex + close.length };
    }

    /**
     * 루비 문자 처리: [[본문|루비]] -> <ruby>본문<rt>루비</rt></ruby>
     * @param {string} text
     * @param {number} index
     * @returns {{ node: Node, nextIndex: number }|null}
     */
    static _parseRubyAt(text, index) {
        const contentStart = index + 2;
        const closeIndex = text.indexOf(']]', contentStart);
        if (closeIndex === -1) return null;

        const inner = text.slice(contentStart, closeIndex);
        const pipeIndex = inner.indexOf('|');
        if (pipeIndex <= 0 || pipeIndex >= inner.length - 1) return null;

        const body = inner.slice(0, pipeIndex);
        const rtText = inner.slice(pipeIndex + 1);

        const ruby = document.createElement('ruby');
        ruby.className = 'lichsoma-ruby';
        ruby.appendChild(this._parseInlineToFragment(body));

        const rt = document.createElement('rt');
        rt.textContent = rtText;
        ruby.appendChild(rt);

        return { node: ruby, nextIndex: closeIndex + 2 };
    }

    /**
     * 이하 메서드는 기존 외부 호출 호환성을 위한 문자열 처리 헬퍼다.
     * 실제 렌더링 처리(processFormatting)는 더 이상 innerHTML 전체 치환에 의존하지 않는다.
     */

    /**
     * 루비 문자 처리: [[본문|루비]] -> <ruby>본문<rt>루비</rt></ruby>
     * @param {string} content - 처리할 텍스트
     * @returns {string} 처리된 텍스트
     */
    static processRuby(content) {
        const rubyPattern = /\[\[([^\|\]]+?)\|([^\]]+?)\]\]/g;
        return content.replace(
            rubyPattern,
            '<ruby class="lichsoma-ruby">$1<rt>$2</rt></ruby>'
        );
    }

    /**
     * 볼드+이탤릭 처리: ***텍스트*** -> <b><i>텍스트</i></b>
     * @param {string} content - 처리할 텍스트
     * @returns {string} 처리된 텍스트
     */
    static processBoldItalic(content) {
        const boldItalicPattern = /\*\*\*([^\*]+?)\*\*\*/g;
        return content.replace(
            boldItalicPattern,
            '<b><i>$1</i></b>'
        );
    }

    /**
     * 볼드 처리: **텍스트** -> <b>텍스트</b>
     * @param {string} content - 처리할 텍스트
     * @returns {string} 처리된 텍스트
     */
    static processBold(content) {
        const boldPattern = /\*\*([^\*]+?)\*\*/g;
        return content.replace(
            boldPattern,
            '<b>$1</b>'
        );
    }

    /**
     * 이탤릭 처리: *텍스트* -> <i>텍스트</i>
     * @param {string} content - 처리할 텍스트
     * @returns {string} 처리된 텍스트
     */
    static processItalic(content) {
        const italicPattern = /\*([^\*]+?)\*/g;
        return content.replace(
            italicPattern,
            '<i>$1</i>'
        );
    }

    /**
     * 취소선 처리: ~~텍스트~~ -> <s>텍스트</s>
     * @param {string} content - 처리할 텍스트
     * @returns {string} 처리된 텍스트
     */
    static processStrikethrough(content) {
        const strikethroughPattern = /~~([^~]+?)~~/g;
        return content.replace(
            strikethroughPattern,
            '<s>$1</s>'
        );
    }
}