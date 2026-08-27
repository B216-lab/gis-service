import type {
  InspectableSchema,
  InspectableTableSummary,
} from '../inspector/api';
import type { DatabaseConnection } from './store';

export type SchemaTablesByName = Record<string, InspectableTableSummary[]>;
export type LoadingSchemaTablesByName = Record<string, boolean>;

export interface CatalogState {
  schemas: InspectableSchema[];
  schemaTablesByName: SchemaTablesByName;
  selectedSchemaNames: string[];
  expandedSchemaNames: string[];
  isLoadingSchemas: boolean;
  loadingSchemaTablesByName: LoadingSchemaTablesByName;
  error: string;
}

export type MovementLayerKind = 'flowmap' | 'arc';

export interface ServerConnectionResponse {
  connections: Array<Pick<DatabaseConnection, 'id' | 'name'>>;
}
