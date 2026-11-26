// React integration for idb-activerecord
// Provides reactive live query hook with SSR safety.

import { useState, useEffect, useRef } from 'react';
import { createLiveQuery, LiveQueryOptions } from './activerecord.js';

export interface UseLiveQueryOptions<T = any> extends LiveQueryOptions {
  initialValue?: T;
  onError?: (err: Error) => void;
}

/**
 * Reactive React hook that executes an ActiveRecord query and automatically
 * re-renders whenever mutations occur locally (create, update, destroy, restore)
 * or remotely via SyncEngine.
 *
 * Safe for Server-Side Rendering (SSR): does not access IndexedDB during server rendering.
 *
 * @example
 * ```tsx
 * import { useLiveQuery } from 'idb-activerecord/react';
 * import { Task } from './models/task';
 *
 * export function TaskList() {
 *   const tasks = useLiveQuery(() => Task.where('done', false).all(), []);
 *   if (!tasks) return <p>Loading...</p>;
 *   return (
 *     <ul>
 *       {tasks.map(t => (
 *         <li key={t.id}>{t.title}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useLiveQuery<T>(
  queryFn: () => Promise<T>,
  deps: any[] = [],
  options: UseLiveQueryOptions<T> = {}
): T | undefined {
  const [data, setData] = useState<T | undefined>(options.initialValue);
  const isMountedRef = useRef(true);
  const queryFnRef = useRef(queryFn);
  queryFnRef.current = queryFn;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    isMountedRef.current = true;

    const store = createLiveQuery<T>(() => queryFnRef.current(), {
      debounceMs: optionsRef.current.debounceMs ?? 30,
      initialValue: optionsRef.current.initialValue
    });

    const unsubscribe = store.subscribe((latestData) => {
      if (isMountedRef.current) {
        setData(latestData);
      }
    });

    return () => {
      isMountedRef.current = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return data;
}

export { createLiveQuery } from './activerecord.js';
