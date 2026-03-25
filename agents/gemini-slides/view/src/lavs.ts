let callId = 0;
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();

export function callEndpoint(endpoint: string, input?: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = String(++callId);
    pending.set(id, { resolve, reject });
    window.parent.postMessage({ type: 'lavs-call', id, endpoint, input }, '*');
  });
}

window.addEventListener('message', (event) => {
  const { data } = event;
  if (data.type === 'lavs-result' && pending.has(data.id)) {
    pending.get(data.id)!.resolve(data.result);
    pending.delete(data.id);
  } else if (data.type === 'lavs-error' && pending.has(data.id)) {
    pending.get(data.id)!.reject(new Error(data.error));
    pending.delete(data.id);
  }
});

export function onAgentAction(callback: () => void) {
  const handler = (event: MessageEvent) => {
    if (event.data.type === 'lavs-agent-action') {
      callback();
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
