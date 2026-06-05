export type TableFilterOperator = 'eq' | 'in';

export interface TableFilterCondition {
  column: string;
  operator: TableFilterOperator;
  value?: string;
  values?: string[];
}

export interface TableFilterDefinition {
  conditions: TableFilterCondition[];
}

export interface SavedTableFilter {
  id: string;
  name: string;
  connectionId: string;
  schema: string;
  table: string;
  createdAt: string;
  filter: TableFilterDefinition;
}
