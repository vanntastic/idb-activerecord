// Type definitions for the library

export interface ModelConfig {
  tableName: string;
  indexes?: Array<{ name: string; keyPath: string; unique?: boolean }>;
  belongsTo?: Record<string, any>;
  hasMany?: Record<string, any>;
  beforeCreate?: (record: any) => void;
  afterCreate?: (record: any) => void;
  beforeUpdate?: (record: any) => void;
  afterUpdate?: (record: any) => void;
  beforeDestroy?: (record: any) => void;
  afterDestroy?: (record: any) => void;
  validates?: Record<string, any>;
}

export interface ValidationRule {
  presence?: boolean;
  length?: { minimum?: number; maximum?: number };
  format?: RegExp;
}
