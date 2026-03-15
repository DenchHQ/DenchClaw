"use client";

import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import {
	useReactTable,
	getCoreRowModel,
	getSortedRowModel,
	getFilteredRowModel,
	getPaginationRowModel,
	flexRender,
	type ColumnDef,
	type SortingState,
	type ColumnFiltersState,
	type VisibilityState,
	type Row,
	type OnChangeFn,
	type PaginationState,
} from "@tanstack/react-table";
import {
	DndContext,
	closestCenter,
	type DragEndEvent,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	horizontalListSortingStrategy,
	useSortable,
	arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { rankItem } from "@tanstack/match-sorter-utils";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuCheckboxItem,
} from "../ui/dropdown-menu";
import { cn } from "@/lib/utils";

/* ─── Types ─── */

export type RowAction<TData> = {
	label: string;
	onClick?: (row: TData) => void;
	icon?: React.ReactNode;
	variant?: "default" | "destructive";
};

export type DataTableProps<TData, TValue> = {
	columns: ColumnDef<TData, TValue>[];
	data: TData[];
	loading?: boolean;
	// search
	searchPlaceholder?: string;
	enableGlobalFilter?: boolean;
	// sorting
	enableSorting?: boolean;
	// row selection
	enableRowSelection?: boolean;
	rowSelection?: Record<string, boolean>;
	onRowSelectionChange?: OnChangeFn<Record<string, boolean>>;
	bulkActions?: React.ReactNode;
	// column features
	enableColumnReordering?: boolean;
	onColumnReorder?: (newOrder: string[]) => void;
	initialColumnVisibility?: VisibilityState;
	onColumnVisibilityChanged?: (visibility: VisibilityState) => void;
	// pagination
	pageSize?: number;
	// actions
	onRefresh?: () => void;
	onAdd?: () => void;
	addButtonLabel?: string;
	onRowClick?: (row: TData, index: number) => void;
	rowActions?: (row: TData) => RowAction<TData>[];
	// toolbar
	toolbarExtra?: React.ReactNode;
	title?: string;
	titleIcon?: React.ReactNode;
	// sticky
	stickyFirstColumn?: boolean;
	// server-side pagination
	serverPagination?: {
		totalCount: number;
		page: number;
		pageSize: number;
		onPageChange: (page: number) => void;
		onPageSizeChange: (size: number) => void;
	};
	// server-side search callback (replaces client-side fuzzy filter)
	onServerSearch?: (query: string) => void;
};

/* ─── Fuzzy filter ─── */

function fuzzyFilter(
	row: Row<unknown>,
	columnId: string,
	filterValue: string,
) {
	const result = rankItem(row.getValue(columnId), filterValue);
	return result.passed;
}

/* ─── Sortable header cell (DnD) ─── */

function SortableHeader({
	id,
	children,
	style,
	className,
}: {
	id: string;
	children: React.ReactNode;
	style?: React.CSSProperties;
	className?: string;
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });

	const dragStyle: React.CSSProperties = {
		...style,
		transform: CSS.Translate.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
		cursor: "grab",
	};

	return (
		<th
			ref={setNodeRef}
			style={dragStyle}
			className={className}
			{...attributes}
			{...listeners}
		>
			{children}
		</th>
	);
}

/* ─── Sort icon ─── */

function SortIcon({ direction }: { direction: "asc" | "desc" | false }) {
	if (!direction) {
		return (
			<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.25 }}>
				<path d="m7 15 5 5 5-5" /><path d="m7 9 5-5 5 5" />
			</svg>
		);
	}
	return (
		<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			{direction === "asc" ? <path d="m5 12 7-7 7 7" /> : <path d="m19 12-7 7-7-7" />}
		</svg>
	);
}

/* ─── Main component ─── */

export function DataTable<TData, TValue>({
	columns,
	data,
	loading = false,
	searchPlaceholder = "Search...",
	enableGlobalFilter = true,
	enableSorting = true,
	enableRowSelection = false,
	rowSelection: externalRowSelection,
	onRowSelectionChange,
	bulkActions,
	enableColumnReordering = false,
	onColumnReorder,
	initialColumnVisibility,
	onColumnVisibilityChanged,
	pageSize: defaultPageSize = 100,
	onRefresh,
	onAdd,
	addButtonLabel = "+ Add",
	onRowClick,
	rowActions,
	toolbarExtra,
	title,
	titleIcon,
	stickyFirstColumn: stickyFirstProp = true,
	serverPagination,
	onServerSearch,
}: DataTableProps<TData, TValue>) {
	const [sorting, setSorting] = useState<SortingState>([]);
	const [globalFilter, setGlobalFilter] = useState("");
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(initialColumnVisibility ?? {});
	// Sync column visibility when the prop changes (e.g. loading a saved view)
	useEffect(() => {
		setColumnVisibility(initialColumnVisibility ?? {});
	}, [initialColumnVisibility]);
	const [internalRowSelection, setInternalRowSelection] = useState<Record<string, boolean>>({});
	const [stickyFirstColumn, setStickyFirstColumn] = useState(stickyFirstProp);
	const [isScrolled, setIsScrolled] = useState(false);
	const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: defaultPageSize });
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	const rowSelectionState = externalRowSelection !== undefined ? externalRowSelection : internalRowSelection;

	// Extract column ID from ColumnDef
	const getColumnId = useCallback((c: ColumnDef<TData, TValue>): string => {
		if ("id" in c && typeof c.id === "string") {return c.id;}
		if ("accessorKey" in c && typeof c.accessorKey === "string") {return c.accessorKey;}
		return "";
	}, []);

	// Column order for DnD — include "select" at start and "actions" at end
	// so TanStack doesn't push them to the end of the table
	const buildColumnOrder = useCallback(
		(dataCols: ColumnDef<TData, TValue>[]) => {
			const dataOrder = dataCols.map(getColumnId);
			const order: string[] = [];
			if (enableRowSelection) {order.push("select");}
			order.push(...dataOrder);
			if (rowActions) {order.push("actions");}
			return order;
		},
		[getColumnId, enableRowSelection, rowActions],
	);

	const [columnOrder, setColumnOrder] = useState<string[]>(() =>
		buildColumnOrder(columns),
	);

	// Update column order when columns change
	useEffect(() => {
		setColumnOrder(buildColumnOrder(columns));
	}, [columns, buildColumnOrder]);

	// DnD sensors
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
	);

	const handleDragEnd = useCallback(
		(event: DragEndEvent) => {
			const { active, over } = event;
			if (over && active.id !== over.id) {
				setColumnOrder((old) => {
					const oldIndex = old.indexOf(active.id as string);
					const newIndex = old.indexOf(over.id as string);
					const newOrder = arrayMove(old, oldIndex, newIndex);
					onColumnReorder?.(newOrder);
					return newOrder;
				});
			}
		},
		[onColumnReorder],
	);

	// Scroll tracking for sticky column shadow
	const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
		setIsScrolled(e.currentTarget.scrollLeft > 0);
	}, []);

	// Build selection column
	const selectionColumn: ColumnDef<TData> | null = enableRowSelection
		? {
				id: "select",
				header: ({ table }) => (
					<input
						type="checkbox"
						checked={table.getIsAllPageRowsSelected()}
						onChange={table.getToggleAllPageRowsSelectedHandler()}
						className="w-3.5 h-3.5 rounded accent-[var(--color-accent)] cursor-pointer"
					/>
				),
				cell: ({ row }) => (
					<input
						type="checkbox"
						checked={row.getIsSelected()}
						onChange={row.getToggleSelectedHandler()}
						onClick={(e) => e.stopPropagation()}
						className="w-3.5 h-3.5 rounded accent-[var(--color-accent)] cursor-pointer"
					/>
				),
				size: 40,
				enableSorting: false,
				enableHiding: false,
			}
		: null;

	// Build actions column
	const actionsColumn: ColumnDef<TData> | null = rowActions
		? {
				id: "actions",
				header: () => null,
				cell: ({ row }) => (
					<RowActionsMenu
						row={row.original}
						actions={rowActions(row.original)}
					/>
				),
				size: 48,
				enableSorting: false,
				enableHiding: false,
			}
		: null;

	const allColumns = useMemo(() => {
		const cols: ColumnDef<TData, TValue>[] = [];
		if (selectionColumn) {cols.push(selectionColumn as ColumnDef<TData, TValue>);}
		cols.push(...columns);
		if (actionsColumn) {cols.push(actionsColumn as ColumnDef<TData, TValue>);}
		return cols;
	}, [columns, selectionColumn, actionsColumn]);

	// Server-side pagination state derived from props
	const serverPaginationState = serverPagination
		? { pageIndex: serverPagination.page - 1, pageSize: serverPagination.pageSize }
		: undefined;

	const table = useReactTable({
		data,
		columns: allColumns,
		state: {
			sorting,
			globalFilter,
			columnFilters,
			columnVisibility,
			rowSelection: rowSelectionState,
			columnOrder: enableColumnReordering ? columnOrder : undefined,
			pagination: serverPaginationState ?? pagination,
		},
		onSortingChange: setSorting,
		onGlobalFilterChange: setGlobalFilter,
		onColumnFiltersChange: setColumnFilters,
		onColumnVisibilityChange: (updater) => {
			const next = typeof updater === "function" ? updater(columnVisibility) : updater;
			setColumnVisibility(next);
			onColumnVisibilityChanged?.(next);
		},
		onRowSelectionChange: (updater) => {
			if (onRowSelectionChange) {
				onRowSelectionChange(updater);
			} else {
				setInternalRowSelection(updater);
			}
		},
		onPaginationChange: serverPagination
			? (updater) => {
				const newVal = typeof updater === "function"
					? updater(serverPaginationState!)
					: updater;
				if (newVal.pageSize !== serverPagination.pageSize) {
					serverPagination.onPageSizeChange(newVal.pageSize);
				} else if (newVal.pageIndex !== serverPagination.page - 1) {
					serverPagination.onPageChange(newVal.pageIndex + 1);
				}
			}
			: setPagination,
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: enableSorting ? getSortedRowModel() : undefined,
		getFilteredRowModel: serverPagination ? undefined : getFilteredRowModel(),
		getPaginationRowModel: serverPagination ? undefined : getPaginationRowModel(),
		...(serverPagination ? {
			manualPagination: true,
			pageCount: Math.ceil(serverPagination.totalCount / serverPagination.pageSize),
		} : {}),
		enableRowSelection,
		enableSorting,
		globalFilterFn: fuzzyFilter,
		columnResizeMode: "onChange",
	});

	const selectedCount = Object.keys(rowSelectionState).filter((k) => rowSelectionState[k]).length;
	const visibleColumns = table.getVisibleFlatColumns().filter((c) => c.id !== "select" && c.id !== "actions");

	// ─── Render ───

	return (
		<div className="w-full h-full flex flex-col overflow-hidden" style={{ overscrollBehavior: "contain" }}>
			{/* Toolbar */}
			<div
				className="flex items-center gap-3 px-3 py-2 shrink-0 flex-wrap backdrop-blur-md"
				style={{ background: "var(--color-glass)", borderBottom: "1px solid var(--color-border)" }}
			>
				{title && (
					<div className="flex items-center gap-2 mr-1">
						{titleIcon}
						<span className="text-xs font-semibold" style={{ color: "var(--color-text)" }}>
							{title}
						</span>
					</div>
				)}

				{/* Search */}
				{enableGlobalFilter && (
					<div
						className="flex items-center gap-2 h-8 px-3 backdrop-blur-sm rounded-full focus-within:ring-2 focus-within:ring-(--color-accent)/30 transition-shadow max-w-[260px] min-w-[140px] shadow-[0_0_21px_0_rgba(0,0,0,0.05)]"
						style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
					>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" style={{ color: "var(--color-text-muted)", opacity: 0.5 }}>
							<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
						</svg>
						<input
							type="text"
							value={globalFilter}
							onChange={(e) => {
								setGlobalFilter(e.target.value);
								onServerSearch?.(e.target.value);
							}}
							placeholder={searchPlaceholder}
							className="w-full h-full text-xs bg-transparent outline-none border-0 p-0"
							style={{ color: "var(--color-text)" }}
						/>
						{globalFilter && (
							<button
								type="button"
								onClick={() => { setGlobalFilter(""); onServerSearch?.(""); }}
								className="shrink-0 h-5 w-5 rounded-full flex items-center justify-center cursor-pointer transition-colors"
								style={{ color: "var(--color-text-muted)" }}
							>
								<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
							</button>
						)}
					</div>
				)}

				{/* Bulk actions */}
				{selectedCount > 0 && bulkActions && (
					<div className="flex items-center gap-2">
						<span className="text-xs font-medium" style={{ color: "var(--color-text-muted)" }}>
							{selectedCount} selected
						</span>
						{bulkActions}
					</div>
				)}

				<div className="flex-1" />

				{toolbarExtra}

				{/* Columns menu */}
				<DropdownMenu>
					<DropdownMenuTrigger
						className="h-8 px-3 flex items-center gap-1.5 rounded-full text-xs cursor-pointer transition-colors backdrop-blur-sm shadow-[0_0_21px_0_rgba(0,0,0,0.05)] outline-none focus:outline-none"
						style={{ color: "var(--color-text-muted)", border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
					>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
							<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /><path d="M15 3v18" />
						</svg>
						Columns
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" sideOffset={6}>
						<DropdownMenuCheckboxItem
							checked={stickyFirstColumn}
							onSelect={() => setStickyFirstColumn((v) => !v)}
						>
							Freeze first column
						</DropdownMenuCheckboxItem>
						<DropdownMenuSeparator />
						{visibleColumns.length === 0 ? (
							<div className="px-2 py-1.5 text-xs opacity-50">No toggleable columns</div>
						) : (
							table.getAllLeafColumns()
								.filter((c) => c.id !== "select" && c.id !== "actions" && c.getCanHide())
								.map((column) => (
									<DropdownMenuCheckboxItem
										key={column.id}
										checked={column.getIsVisible()}
										onSelect={() => column.toggleVisibility(!column.getIsVisible())}
									>
										{typeof column.columnDef.header === "string"
											? column.columnDef.header
											: String((column.columnDef.meta as Record<string, string> | undefined)?.label ?? column.id)}
									</DropdownMenuCheckboxItem>
								))
						)}
					</DropdownMenuContent>
				</DropdownMenu>

				{/* Refresh button */}
				{onRefresh && (
					<button
						type="button"
						onClick={onRefresh}
						className="h-8 w-8 rounded-full flex items-center justify-center cursor-pointer transition-colors backdrop-blur-sm shadow-[0_0_21px_0_rgba(0,0,0,0.05)]"
						style={{ border: "1px solid var(--color-border)", background: "var(--color-surface)", color: "var(--color-text-muted)" }}
					>
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" /><path d="M16 21h5v-5" /></svg>
					</button>
				)}

				{/* Add button */}
				{onAdd && (
					<button
						type="button"
						onClick={onAdd}
						className="h-8 px-3 flex items-center gap-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors shadow-[0_0_21px_0_rgba(0,0,0,0.05)]"
						style={{
							background: "var(--color-accent)",
							color: "#fff",
						}}
					>
						{addButtonLabel}
					</button>
				)}
			</div>

			{/* Table */}
			<div
				ref={scrollContainerRef}
				className="overflow-auto flex-1 min-h-0 max-h-full relative"
				onScroll={handleScroll}
				style={{ overscrollBehavior: "contain" }}
			>
				{loading ? (
					<LoadingSkeleton columnCount={allColumns.length} />
				) : data.length === 0 ? (
					<div className="flex flex-col items-center justify-center py-24 gap-4">
						<div
							className="rounded-full p-4 mb-2 backdrop-blur-sm"
							style={{ background: "var(--color-glass)", border: "1px solid var(--color-border)", boxShadow: "var(--shadow-sm)" }}
						>
							<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ color: "var(--color-text-muted)" }}>
								<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
							</svg>
						</div>
						<div className="text-center">
							<h3 className="text-base font-semibold mb-1" style={{ color: "var(--color-text)" }}>No results found</h3>
							<p className="text-sm max-w-xs" style={{ color: "var(--color-text-muted)" }}>
								{globalFilter
									? "Try adjusting your search or filter criteria."
									: "No data available yet. Create your first entry to get started."}
							</p>
						</div>
					</div>
				) : (
					<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
						<table
							className="w-full caption-bottom text-sm"
							style={{ tableLayout: "fixed", minWidth: table.getCenterTotalSize() }}
						>
							<thead className="[&_tr]:border-b sticky top-0 z-30" style={{ background: "var(--color-surface)" }}>
								{table.getHeaderGroups().map((headerGroup) => (
									<tr
										key={headerGroup.id}
										style={{ borderColor: "var(--color-border)" }}
										className="border-b-2 backdrop-blur-sm"
									>
										<SortableContext items={columnOrder} strategy={horizontalListSortingStrategy}>
											{headerGroup.headers.map((header, colIdx) => {
												const isFirstData = colIdx === (enableRowSelection ? 1 : 0);
												const isSticky = stickyFirstColumn && isFirstData;
												const isSelectCol = header.id === "select";
												const isActionsCol = header.id === "actions";
												const canSort = header.column.getCanSort();
												const isSorted = header.column.getIsSorted();
												const isLastCol = colIdx === headerGroup.headers.length - 1;

												const headerStyle: React.CSSProperties = {
													background: "var(--color-surface)",
													position: "sticky",
													top: 0,
													zIndex: isSticky || isSelectCol ? 31 : 30,
													...(isSticky ? {
														left: enableRowSelection ? 40 : 0,
														boxShadow: isScrolled ? "4px 0 12px -2px rgba(0,0,0,0.15), 2px 0 4px -1px rgba(0,0,0,0.08)" : "none",
													} : {}),
													...(isSelectCol ? { left: 0, position: "sticky", zIndex: 31, width: 40 } : {}),
													width: header.getSize(),
												};

												const content = header.isPlaceholder
													? null
													: flexRender(header.column.columnDef.header, header.getContext());

												const thClassName = cn(
													"h-11 text-left align-middle font-medium text-xs uppercase tracking-wider whitespace-nowrap p-0 group select-none relative box-border",
													!isLastCol && "border-r",
													isSticky && isScrolled && "border-r-2!",
												);

												const innerClassName = cn(
													"flex items-center gap-1 h-full px-4 transition-colors",
													canSort && "cursor-pointer hover:bg-[var(--color-surface-hover)]",
													isSorted && "bg-[var(--color-surface-hover)]",
												);

												if (enableColumnReordering && !isSelectCol && !isActionsCol) {
													return (
														<SortableHeader
															key={header.id}
															id={header.id}
															style={headerStyle}
															className={thClassName}
														>
															<span
																className={innerClassName}
																onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
																style={{ color: "var(--color-text-muted)" }}
															>
																{content}
																{canSort && <SortIcon direction={isSorted} />}
															</span>
															{isSticky && isScrolled && (
																<div className="absolute top-0 right-0 bottom-0 w-4 translate-x-full pointer-events-none bg-linear-to-r from-black/4 to-transparent z-100" />
															)}
														</SortableHeader>
													);
												}

												return (
													<th
														key={header.id}
														style={{
															...headerStyle,
															borderColor: "var(--color-border)",
														}}
														className={thClassName}
													>
														<span
															className={innerClassName}
															onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
															style={{ color: "var(--color-text-muted)" }}
														>
															{content}
															{canSort && <SortIcon direction={isSorted} />}
														</span>
														{isSticky && isScrolled && (
															<div className="absolute top-0 right-0 bottom-0 w-4 translate-x-full pointer-events-none bg-linear-to-r from-black/4 to-transparent z-100" />
														)}
													</th>
												);
											})}
										</SortableContext>
									</tr>
								))}
							</thead>
							<tbody className="[&_tr:last-child]:border-0">
								{table.getRowModel().rows.map((row, rowIdx) => {
									const isSelected = row.getIsSelected();
									const visibleCells = row.getVisibleCells();
									return (
										<tr
											key={row.id}
											data-state={isSelected ? "selected" : undefined}
											className={cn(
												"border-b transition-all duration-150 group/row relative",
												onRowClick && "cursor-pointer",
												isSelected && "data-[state=selected]:bg-(--color-accent-light)",
											)}
											style={{
												borderColor: "var(--color-border)",
												background: isSelected
													? "var(--color-accent-light)"
													: rowIdx % 2 === 0
														? "var(--color-surface)"
														: "var(--color-bg)",
											}}
											onClick={() => onRowClick?.(row.original, rowIdx)}
											onMouseEnter={(e) => {
												if (!isSelected)
													{(e.currentTarget as HTMLElement).style.background = "var(--color-surface-hover)";}
											}}
											onMouseLeave={(e) => {
												if (!isSelected)
													{(e.currentTarget as HTMLElement).style.background =
														rowIdx % 2 === 0 ? "var(--color-surface)" : "var(--color-bg)";}
											}}
										>
											{visibleCells.map((cell, colIdx) => {
												const isFirstData = colIdx === (enableRowSelection ? 1 : 0);
												const isSticky = stickyFirstColumn && isFirstData;
												const isSelectCol = cell.column.id === "select";
												const isLastCol = colIdx === visibleCells.length - 1;

												const rowBg = isSelected
													? "var(--color-accent-light)"
													: rowIdx % 2 === 0
														? "var(--color-surface)"
														: "var(--color-bg)";

												const cellStyle: React.CSSProperties = {
													borderColor: "var(--color-border)",
													...(isSticky
														? {
																position: "sticky" as const,
																left: enableRowSelection ? 40 : 0,
																zIndex: 20,
																background: rowBg,
																boxShadow: isScrolled ? "4px 0 12px -2px rgba(0,0,0,0.12), 2px 0 4px -1px rgba(0,0,0,0.06)" : "none",
															}
														: {}),
													...(isSelectCol
														? {
																position: "sticky" as const,
																left: 0,
																zIndex: 20,
																background: rowBg,
																width: 40,
															}
														: {}),
												};

												return (
													<td
														key={cell.id}
														className={cn(
															"px-3 py-1.5 align-middle whitespace-nowrap text-xs border-b transition-colors box-border",
															!isLastCol && "border-r",
															isSticky && isScrolled && "border-r-2!",
														)}
														style={cellStyle}
													>
														<div className="overflow-hidden">
															{flexRender(cell.column.columnDef.cell, cell.getContext())}
														</div>
														{isSticky && isScrolled && (
															<div className="absolute top-0 right-0 bottom-0 w-4 translate-x-full pointer-events-none bg-linear-to-r from-black/4 to-transparent z-100" />
														)}
													</td>
												);
											})}
										</tr>
									);
								})}
							</tbody>
						</table>
					</DndContext>
				)}
			</div>

			{/* Pagination footer */}
			{!loading && data.length > 0 && (
				<div
					className="flex items-center justify-between px-3 py-2 text-xs shrink-0 backdrop-blur-xl"
					style={{
						borderTop: "1px solid var(--color-border)",
						color: "var(--color-text-muted)",
						background: "var(--color-glass)",
					}}
				>
					<span className="text-xs font-medium">
						{serverPagination
							? `Showing ${(serverPagination.page - 1) * serverPagination.pageSize + 1}–${Math.min(serverPagination.page * serverPagination.pageSize, serverPagination.totalCount)} of ${serverPagination.totalCount} results`
							: `Showing ${table.getRowModel().rows.length} of ${data.length} results`}
						{selectedCount > 0 && ` (${selectedCount} selected)`}
					</span>
					<div className="flex items-center gap-3">
						<div className="flex items-center gap-2">
							<span className="text-xs font-medium">Rows per page</span>
							<select
								value={serverPagination ? serverPagination.pageSize : pagination.pageSize}
								onChange={(e) => {
									const newSize = Number(e.target.value);
									if (serverPagination) {
										serverPagination.onPageSizeChange(newSize);
									} else {
										setPagination((p) => ({ ...p, pageSize: newSize, pageIndex: 0 }));
									}
								}}
								className="h-7 px-2 py-0 rounded-full text-xs outline-none shadow-[0_0_21px_0_rgba(0,0,0,0.05)] transition-colors"
								style={{
									background: "var(--color-surface)",
									color: "var(--color-text)",
									border: "1px solid var(--color-border)",
								}}
							>
								{[20, 50, 100, 250, 500].map((size) => (
									<option key={size} value={size}>{size}</option>
								))}
							</select>
						</div>
						<span className="text-xs font-medium min-w-[80px] text-center">
							Page {serverPagination ? serverPagination.page : pagination.pageIndex + 1} of {table.getPageCount()}
						</span>
						<div className="flex gap-1">
							{serverPagination ? (
								<>
									<PaginationButton onClick={() => serverPagination.onPageChange(1)} disabled={serverPagination.page <= 1} label="&laquo;" />
									<PaginationButton onClick={() => serverPagination.onPageChange(serverPagination.page - 1)} disabled={serverPagination.page <= 1} label="&lsaquo;" />
									<PaginationButton onClick={() => serverPagination.onPageChange(serverPagination.page + 1)} disabled={serverPagination.page >= Math.ceil(serverPagination.totalCount / serverPagination.pageSize)} label="&rsaquo;" />
									<PaginationButton onClick={() => serverPagination.onPageChange(Math.ceil(serverPagination.totalCount / serverPagination.pageSize))} disabled={serverPagination.page >= Math.ceil(serverPagination.totalCount / serverPagination.pageSize)} label="&raquo;" />
								</>
							) : (
								<>
									<PaginationButton onClick={() => setPagination((p) => ({ ...p, pageIndex: 0 }))} disabled={!table.getCanPreviousPage()} label="&laquo;" />
									<PaginationButton onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} label="&lsaquo;" />
									<PaginationButton onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} label="&rsaquo;" />
									<PaginationButton onClick={() => setPagination((p) => ({ ...p, pageIndex: table.getPageCount() - 1 }))} disabled={!table.getCanNextPage()} label="&raquo;" />
								</>
							)}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

/* ─── Sub-components ─── */

function PaginationButton({ onClick, disabled, label }: { onClick: () => void; disabled: boolean; label: string }) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			className="h-7 w-7 rounded-full flex items-center justify-center text-xs disabled:opacity-30 cursor-pointer transition-colors backdrop-blur-sm shadow-[0_0_21px_0_rgba(0,0,0,0.05)]"
			style={{ color: "var(--color-text-muted)", border: "1px solid var(--color-border)", background: "var(--color-surface)" }}
			// biome-ignore lint: using html entity label
			dangerouslySetInnerHTML={{ __html: label }}
		/>
	);
}

function RowActionsMenu<TData>({ row, actions }: { row: TData; actions: RowAction<TData>[] }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				className="p-1 rounded-md cursor-pointer"
				style={{ color: "var(--color-text-muted)" }}
				onClick={(e) => e.stopPropagation()}
			>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="12" cy="19" r="1.5" /></svg>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" sideOffset={4}>
				{actions.map((action, i) => (
					<DropdownMenuItem
						key={i}
						variant={action.variant === "destructive" ? "destructive" : "default"}
						onSelect={() => action.onClick?.(row)}
					>
						{action.icon}
						{action.label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function LoadingSkeleton({ columnCount }: { columnCount: number }) {
	const widths = ["w-full", "w-3/4", "w-5/6", "w-2/3"];
	return (
		<div className="w-full">
			{/* Skeleton header */}
			<div className="flex gap-0 border-b-2" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
				{Array.from({ length: Math.min(columnCount, 6) }).map((_col, j) => (
					<div key={j} className="flex-1 h-11 px-4 flex items-center" style={{ borderRight: j < Math.min(columnCount, 6) - 1 ? "1px solid var(--color-border)" : "none" }}>
						<div
							className="h-3 w-16 rounded animate-pulse"
							style={{ background: "var(--color-surface-hover)", animationDelay: `${j * 50}ms`, animationDuration: "1.5s" }}
						/>
					</div>
				))}
			</div>
			{/* Skeleton rows */}
			{Array.from({ length: 15 }).map((_, i) => (
				<div
					key={i}
					className="flex gap-0 border-b"
					style={{ borderColor: "var(--color-border)" }}
				>
					{Array.from({ length: Math.min(columnCount, 6) }).map((_col, j) => (
						<div
							key={j}
							className="flex-1 px-3 py-2.5 flex items-center"
							style={{ borderRight: j < Math.min(columnCount, 6) - 1 ? "1px solid var(--color-border)" : "none" }}
						>
							<div
								className={cn("h-3.5 rounded animate-pulse", widths[(i + j) % widths.length])}
								style={{
									background: "var(--color-surface-hover)",
									animationDelay: `${(i * 50) + (j * 30)}ms`,
									animationDuration: "1.5s",
								}}
							/>
						</div>
					))}
				</div>
			))}
		</div>
	);
}
