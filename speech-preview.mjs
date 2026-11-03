export function sameSpeech(a, b) {
  const normalize = text => text.trim().toLowerCase().replace(/’/g,"'").replace(/[.!?,;:]+$/g,'').replace(/\s+/g,' ');
  return normalize(a) === normalize(b);
}

export function createSpeechPreview({ onPreview, onFinal, quietMs = 180, maxWaitMs = 450, minWords = 3, minGapMs = 300, schedule = setTimeout, cancel = clearTimeout, now = Date.now }) {
  const results = new Map();
  let disposed = false;
  function clear(state) { if(state.quiet)cancel(state.quiet);if(state.deadline)cancel(state.deadline);state.quiet=state.deadline=null; }
  function preview(index, state) {
    if(disposed || state.final || sameSpeech(state.previewText,state.text) || state.text.split(/\s+/).length < minWords) return;
    clear(state);state.previewText=state.text;state.previewAt=now();onPreview(index,state.text);
  }
  return {
    update(index, text, final = false) {
      if(disposed || !text.trim())return;
      text=text.trim();
      let state=results.get(index);
      if(!state){state={text:'',final:false,previewText:'',previewAt:-Infinity,quiet:null,deadline:null};results.set(index,state);}
      if(state.final)return;
      if(final){state.text=text;state.final=true;clear(state);onFinal(index,text);return;}
      if(state.text===text)return;
      state.text=text;
      if(sameSpeech(state.previewText,text) || text.split(/\s+/).length < minWords)return;
      if(state.quiet)cancel(state.quiet);
      const remaining=Math.max(0,minGapMs-(now()-state.previewAt));
      state.quiet=schedule(()=>{state.quiet=null;preview(index,state);},Math.max(quietMs,remaining));
      if(!state.deadline)state.deadline=schedule(()=>{state.deadline=null;preview(index,state);},Math.max(maxWaitMs,remaining));
    },
    flush(){if(disposed)return;for(const [index,state] of results)if(!state.final&&state.text){state.final=true;clear(state);onFinal(index,state.text);}},
    dispose(){disposed=true;for(const state of results.values())clear(state);results.clear();},
  };
}
