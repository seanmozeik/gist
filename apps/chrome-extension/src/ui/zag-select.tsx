import { normalizeProps, useMachine } from '@zag-js/preact';
import * as select from '@zag-js/select';
import { useEffect, useMemo, useRef } from 'preact/hooks';

const OPEN_EVENT = 'summarize:select-open';

export interface SelectItem { label: string; value: string; disabled?: boolean }

interface UseZagSelectArgs {
  id: string;
  items: SelectItem[];
  value: string;
  onValueChange: (value: string) => void;
}

export function useZagSelect({ id, items, value, onValueChange }: UseZagSelectArgs) {
  const collection = useMemo(
    () =>
      select.collection({
        isItemDisabled: (item) => Boolean(item.disabled),
        itemToString: (item) => item.label,
        itemToValue: (item) => item.value,
        items,
      }),
    [items],
  );

  const syncing = useRef(false);

  const service = useMachine(select.machine, {
    collection,
    defaultValue: value ? [value] : [],
    id,
    onValueChange: ({ value: next }: select.ValueChangeDetails) => {
      if (syncing.current) return;
      onValueChange(next[0] ?? '');
    },
    positioning: {
      fitViewport: true,
      flip: true,
      gutter: 6,
      overflowPadding: 8,
      placement: 'bottom-start',
      sameWidth: true,
      shift: 8,
      strategy: 'fixed',
    },
  });

  const api = select.connect(service, normalizeProps);
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const handler = (event: Event) => {
      const {detail} = (event as CustomEvent<{ id?: string }>);
      if (!detail || detail.id === id) {return;}
      apiRef.current.setOpen(false);
    };
    window.addEventListener(OPEN_EVENT, handler as EventListener);
    return () => {
      window.removeEventListener(OPEN_EVENT, handler as EventListener);
    };
  }, [id]);

  useEffect(() => {
    if (!api.open) {return;}
    window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { id } }));
  }, [api.open, id]);

  useEffect(() => {
    const nextValue = value ? [value] : [];
    const current = apiRef.current.value[0] ?? '';
    if (current === (nextValue[0] ?? '')) {return;}
    syncing.current = true;
    apiRef.current.setValue(nextValue);
    queueMicrotask(() => {
      syncing.current = false;
    });
  }, [value]);

  return api;
}
