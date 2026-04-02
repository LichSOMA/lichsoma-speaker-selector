/**
 * LichSOMA Chat Handler
 * 채팅 메시지에서 마크다운 스타일 포맷팅 처리
 * - 루비 문자: [[텍스트|루비]]
 * - 취소선: ~텍스트~
 * - 이탤릭: *텍스트*
 * - 볼드: **텍스트**
 * - 볼드+이탤릭: ***텍스트***
 */

export class ChatRubyHandler {
    /**
     * 초기화
     */
    static initialize() {
        // 채팅 메시지 렌더링 시 마크다운 포맷팅 처리
        Hooks.on('renderChatMessageHTML', (message, html, data) => {
            try {
                // html이 HTMLElement이므로 jQuery로 변환
                const $html = $(html);
                
                // 메시지 내용에서 포맷팅 처리
                const messageContent = $html.find('.message-content');
                if (messageContent.length) {
                    this.processFormatting(messageContent[0]);
                }
                
                // 헤더(발신자 이름)에서도 포맷팅 처리
                const messageSender = $html.find('.message-sender[data-lichsoma-sender="true"]').length
                    ? $html.find('.message-sender[data-lichsoma-sender="true"]')
                    : $html.find('.message-sender');
                if (messageSender.length) {
                    this.processFormatting(messageSender[0]);
                }
            } catch (e) {
                // 포맷팅 처리 중 오류 (무시)
            }
        });
    }
    
    /**
     * 모든 포맷팅 처리
     * @param {HTMLElement} element - 처리할 요소
     */
    static processFormatting(element) {
        if (!element) return;
        
        // 이미 처리된 요소는 건너뛰기 (중복 처리 방지)
        if (element.dataset.lichsomaFormatProcessed) return;
        
        try {
            // innerHTML을 직접 처리
            if (element.innerHTML) {
                let content = element.innerHTML;
                
                // 1. 루비 문자: [[본문|루비]] -> <ruby>본문<rt>루비</rt></ruby>
                content = this.processRuby(content);
                
                // 2. 볼드+이탤릭: ***텍스트*** -> <b><i>텍스트</i></b> (가장 먼저 처리)
                content = this.processBoldItalic(content);
                
                // 3. 볼드: **텍스트** -> <b>텍스트</b>
                content = this.processBold(content);
                
                // 4. 이탤릭: *텍스트* -> <i>텍스트</i>
                content = this.processItalic(content);
                
                // 5. 취소선: ~텍스트~ -> <s>텍스트</s>
                content = this.processStrikethrough(content);
                
                element.innerHTML = content;
            }
            
            // 처리 완료 표시
            element.dataset.lichsomaFormatProcessed = 'true';
        } catch (e) {
            // 포맷팅 처리 중 오류 (무시)
        }
    }
    
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
     * 취소선 처리: ~텍스트~ -> <s>텍스트</s>
     * @param {string} content - 처리할 텍스트
     * @returns {string} 처리된 텍스트
     */
    static processStrikethrough(content) {
        const strikethroughPattern = /~([^~]+?)~/g;
        return content.replace(
            strikethroughPattern,
            '<s>$1</s>'
        );
    }
}

