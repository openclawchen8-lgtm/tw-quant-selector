import { useRef, useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import SkeletonLoader from './SkeletonLoader';
import EmptyState from './EmptyState';
import styles from './BaseTable.module.css';

interface BaseTableProps<T extends Record<string, any>> {
  columns: ColumnDef<T, any>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  dense?: boolean;
  sortable?: boolean;
  sortState?: SortingState;
  onSortChange?: (state: SortingState) => void;
  onRowClick?: (row: T) => void;
  renderRowDetail?: (row: T) => ReactNode;
  /** Return a label to show as a group divider between this row and the previous one, or null */
  groupLabel?: (row: T, index: number, all: T[]) => string | null;
  getRowId?: (row: T) => string;
  skeletonRows?: number;
  maxHeight?: string;
}

const DIVIDER_TYPE = Symbol('divider');

export default function BaseTable<T extends Record<string, any>>({
  columns, data, loading, emptyMessage = '暫無資料',
  dense, sortable = true, sortState: externalSort, onSortChange,
  onRowClick, renderRowDetail, groupLabel, getRowId,
  skeletonRows = 8, maxHeight,
}: BaseTableProps<T>) {
  const [internalSort, setInternalSort] = useState<SortingState>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [focusIndex, setFocusIndex] = useState(-1);
  const tableRef = useRef<HTMLDivElement>(null);

  const sorting = externalSort ?? internalSort;
  const setSorting = onSortChange ?? setInternalSort;

  const tableData = useMemo(() => {
    if (loading) return [];
    if (!groupLabel) return data;
    const result: (T | { _divider: string; _type: symbol })[] = [];
    for (let i = 0; i < data.length; i++) {
      const label = groupLabel(data[i], i, data);
      if (label && i > 0) {
        result.push({ _divider: label, _type: DIVIDER_TYPE });
      }
      result.push(data[i]);
    }
    return result;
  }, [data, groupLabel, loading]);

  const table = useReactTable({
    data: tableData as any[],
    columns,
    state: { sorting },
    onSortingChange: (updater: any) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      setSorting(next);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: sortable ? getSortedRowModel() : undefined,
    getRowId: getRowId as any,
    manualSorting: !!onSortChange,
  });

  const toggleExpand = useCallback((id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent, rowCount: number) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusIndex((i) => Math.min(i + 1, rowCount - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setFocusIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setFocusIndex(rowCount - 1);
        break;
      case 'Enter': {
        e.preventDefault();
        const row = table.getRowModel().rows[focusIndex];
        if (row && (row.original as any)._type !== DIVIDER_TYPE) {
          if (renderRowDetail) toggleExpand(row.id);
          else if (onRowClick) onRowClick(row.original as T);
        }
        break;
      }
      case 'Escape':
        e.preventDefault();
        setExpandedRows(new Set());
        break;
    }
  }, [focusIndex, renderRowDetail, onRowClick, toggleExpand, table]);

  if (loading) {
    return (
      <div className={styles.wrapper} ref={tableRef} tabIndex={0} style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
        <table className={`${styles.table} ${dense ? styles.dense : ''}`} role="grid">
          <thead>
            <tr>{columns.map((col, i) => (
              <th key={i} style={{ width: (col as any).meta?.width } as React.CSSProperties}>
                {flexRender(col.header, {} as any)}
              </th>
            ))}</tr>
          </thead>
        </table>
        <SkeletonLoader variant="table" rows={skeletonRows} />
      </div>
    );
  }

  if (!loading && data.length === 0) {
    return (
      <div className={styles.wrapper}>
        <table className={`${styles.table} ${dense ? styles.dense : ''}`}>
          <thead>
            <tr>{columns.map((col, i) => (
              <th key={i} style={{ width: (col as any).meta?.width } as React.CSSProperties}>
                {flexRender(col.header, {} as any)}
              </th>
            ))}</tr>
          </thead>
        </table>
        <EmptyState message={emptyMessage} />
      </div>
    );
  }

  const rows = table.getRowModel().rows;

  return (
    <div
      className={styles.wrapper}
      ref={tableRef}
      tabIndex={0}
      role="grid"
      aria-label="data table"
      onKeyDown={(e) => handleKeyDown(e, rows.length)}
      style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
    >
      <table className={`${styles.table} ${dense ? styles.dense : ''}`}>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => {
                const sortDir = header.column.getIsSorted();
                const meta = header.column.columnDef.meta as any;
                return (
                  <th
                    key={header.id}
                    style={{ width: meta?.width, cursor: sortable ? 'pointer' : undefined } as React.CSSProperties}
                    onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
                    aria-sort={sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : undefined}
                    data-type={meta?.align === 'right' ? 'number' : undefined}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {sortable && sortDir === 'asc' && <span className={styles.sortIcon}> ▲</span>}
                    {sortable && sortDir === 'desc' && <span className={styles.sortIcon}> ▼</span>}
                    {sortable && !sortDir && <span className={styles.sortIconMuted}> ──</span>}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const raw = row.original as any;
            if (raw._type === DIVIDER_TYPE) {
              return (
                <tr key={`div-${idx}`} className={styles.groupDividerRow}>
                  <td colSpan={columns.length} className={styles.groupDivider}>
                    — {raw._divider} —
                  </td>
                </tr>
              );
            }
            const isExpanded = expandedRows.has(row.id);
            const isFocused = idx === focusIndex;
            return (
              <tr key={row.id} role="row" aria-expanded={isExpanded}>
                <td colSpan={columns.length} style={{ padding: 0 }}>
                  <table className={styles.innerTable}>
                    <tbody>
                      <tr
                        className={`${styles.dataRow} ${dense ? styles.denseRow : ''} ${isFocused ? styles.focused : ''}`}
                        tabIndex={-1}
                        onClick={() => {
                          if (renderRowDetail) toggleExpand(row.id);
                          else onRowClick?.(raw as T);
                        }}
                        onMouseEnter={() => setFocusIndex(idx)}
                        onFocus={() => setFocusIndex(idx)}
                      >
                        {row.getVisibleCells().map((cell) => {
                          const meta = cell.column.columnDef.meta as any;
                          return (
                            <td
                              key={cell.id}
                              style={{ width: meta?.width } as React.CSSProperties}
                              data-type={meta?.align === 'right' ? 'number' : undefined}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          );
                        })}
                      </tr>
                      {isExpanded && renderRowDetail && (
                        <tr className={styles.expandedRow}>
                          <td colSpan={row.getVisibleCells().length} className={styles.inlineDetail}>
                            {renderRowDetail(raw as T)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
