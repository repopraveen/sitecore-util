export type Scope = "SingleItem" | "ItemAndDescendants";

export type MergeStrategy =
  | "OverrideExistingItem"
  | "KeepExistingItem"
  | "LatestWin"
  | "OverrideExistingTree";

export interface DataTree {
  ItemPath: string;
  Scope: Scope;
  MergeStrategy: MergeStrategy;
}

export interface EnvCredentials {
  /** CM host, e.g. https://xmc-yourorg-project-env.sitecorecloud.io */
  host: string;
  clientId: string;
  clientSecret: string;
}

export interface ChunkSetMetadata {
  ChunkSetId: string;
  ChunkCount: number;
  TotalItemCount: number;
}

export interface TransferStatus {
  State: string;
  ChunkSetsMetadata?: ChunkSetMetadata[];
}

export type StepState = "pending" | "active" | "done" | "warn" | "error";

export interface RunStep {
  id: string;
  label: string;
  state: StepState;
  detail?: string;
}
