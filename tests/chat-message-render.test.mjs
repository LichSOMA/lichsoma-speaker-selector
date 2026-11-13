import test from 'node:test';
import assert from 'node:assert/strict';
import {renderSystemChatMessage} from '../scripts/lichsoma-chat-message-render.js';
import {withChatRenderContext, getChatRenderContext} from '../scripts/lichsoma-chat-render-pipeline.js';

test('history/export rendering delegates to the native legacy compatibility bridge once', async () => {
    const base = {dtBadge:false}, message = {renderHTML:async()=>base, getHTML:async()=>({...base,dtBadge:true})};
    let calls = 0;
    globalThis.foundry = {applications:{sidebar:{tabs:{ChatLog:{async renderMessage(m, options) {
        calls++;
        assert.equal(m,message);
        assert.equal(options.canDelete,false);
        assert.equal(getChatRenderContext(m).mode,'export');
        return m.getHTML(options);
    }}}}}};
    const rendered = await withChatRenderContext(message,{mode:'export'},()=>renderSystemChatMessage(message,{canDelete:false}));
    assert.equal(rendered.dtBadge,true);
    assert.equal(calls,1);
    assert.equal(getChatRenderContext(message),null);
});
test('older Foundry and modern renderers keep their normal options and return type', async () => {
    globalThis.foundry = {};
    const options = {canClose:false};
    assert.equal(await renderSystemChatMessage({renderHTML:async o=>o},options), options);
    assert.equal(await renderSystemChatMessage({getHTML:async()=> 'legacy'}), 'legacy');
    await assert.rejects(renderSystemChatMessage({}), /supported HTML renderer/);
});
