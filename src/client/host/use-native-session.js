import React from 'react';
import {openNativeSession,nativeSessionTarget} from './navigation.js';

/** Local status only. Opening a conversation never answers its approval. */
export function useNativeSession(scope) {
  const [error,setError]=React.useState('');
  const [opening,setOpening]=React.useState(false);
  const lifetime=React.useRef(null),pending=React.useRef(null);
  React.useEffect(()=>{
    const current={};lifetime.current=current;pending.current=null;setError('');setOpening(false);
    return ()=>{
      if(lifetime.current!==current)return;
      pending.current?.controller.abort();pending.current=null;lifetime.current=null;
    };
  },[scope]);
  function open(seat) {
    const target=nativeSessionTarget(seat),key=JSON.stringify(target);
    if(pending.current?.key===key)return pending.current.promise;
    pending.current?.controller.abort();
    const current=lifetime.current,controller=new AbortController();
    setError('');setOpening(true);
    const promise=openNativeSession(target,{signal:controller.signal}).then(result=>{
      if(current&&lifetime.current===current&&pending.current?.promise===promise){
        setOpening(false);
        if(!result.cancelled)setError(result.ok?'':result.error);
      }
      return result;
    }).finally(()=>{if(pending.current?.promise===promise)pending.current=null;});
    pending.current={key,promise,controller};
    return promise;
  }
  return {error,opening,open};
}
