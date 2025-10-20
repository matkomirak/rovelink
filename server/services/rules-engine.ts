import { get, set } from 'lodash';

export type ConflictPolicy = 'provider-wins' | 'cmdb-wins' | 'manual-only' | 'merge';

export interface TransformConfig {
  type: 'lower' | 'upper' | 'title' | 'to_slug' | 'strip' | 'concat' | 'map' | 'regex_extract' | 'lookup_table' | 'datetime_parse' | 'pick_primary_ipv4';
  params?: any;
}

export interface FieldRule {
  source?: string; // Source field path (e.g., "name", "config.network.ip")
  target: string; // Target field path
  transforms?: TransformConfig[];
  defaultValue?: any;
  required?: boolean;
  conflictPolicy?: ConflictPolicy;
}

export interface ChildMapping {
  sourceType: string;
  targetType: string;
  sourcePath: string;
  targetPath: string;
  rules: MappingRules;
}

export interface MappingRules {
  target: string; // Target object type
  matchBy?: string[]; // Fields to match existing objects (e.g., ["custom_fields.ext_id"])
  fields: FieldRule[];
  children?: ChildMapping[];
  conflicts?: {
    defaultPolicy?: ConflictPolicy;
    fieldPolicies?: Record<string, ConflictPolicy>;
  };
  lookupTables?: Record<string, Record<string, any>>;
}

export class RulesEngine {
  
  applyTransforms(value: any, transforms: TransformConfig[]): any {
    let result = value;
    
    for (const transform of transforms) {
      result = this.applyTransform(result, transform);
    }
    
    return result;
  }

  applyTransform(value: any, transform: TransformConfig): any {
    if (value === null || value === undefined) {
      return value;
    }

    switch (transform.type) {
      case 'lower':
        return typeof value === 'string' ? value.toLowerCase() : value;
      
      case 'upper':
        return typeof value === 'string' ? value.toUpperCase() : value;
      
      case 'title':
        return typeof value === 'string' 
          ? value.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase())
          : value;
      
      case 'to_slug':
        return typeof value === 'string'
          ? value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
          : value;
      
      case 'strip':
        return typeof value === 'string' ? value.trim() : value;
      
      case 'concat':
        const parts = transform.params?.parts || [];
        return parts.map((part: any) => {
          if (typeof part === 'string' && part.startsWith('$')) {
            return get(this, part.substring(1), '');
          }
          return part;
        }).join(transform.params?.separator || '');
      
      case 'map':
        const mapping = transform.params?.mapping || {};
        return mapping[value] !== undefined ? mapping[value] : (transform.params?.default || value);
      
      case 'regex_extract':
        if (typeof value !== 'string') return value;
        const regex = new RegExp(transform.params?.pattern || '', transform.params?.flags || '');
        const match = value.match(regex);
        if (match) {
          const groupIndex = transform.params?.group || 0;
          return match[groupIndex];
        }
        return transform.params?.default || value;
      
      case 'lookup_table':
        const tableName = transform.params?.table;
        const key = transform.params?.key || value;
        const lookupTables = transform.params?.lookupTables || {};
        const table = lookupTables[tableName];
        if (table && table[key] !== undefined) {
          return table[key];
        }
        return transform.params?.default || value;
      
      case 'datetime_parse':
        const inputFormat = transform.params?.inputFormat;
        const outputFormat = transform.params?.outputFormat || 'iso8601';
        // Basic ISO 8601 support - could be extended with date-fns
        if (typeof value === 'string') {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            return outputFormat === 'iso8601' ? date.toISOString() : date.toISOString();
          }
        }
        return value;
      
      case 'pick_primary_ipv4':
        if (Array.isArray(value)) {
          // Find first valid IPv4 address
          const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
          for (const item of value) {
            const ip = typeof item === 'string' ? item : item?.address || item?.ip;
            if (ip && ipv4Pattern.test(ip)) {
              return ip;
            }
          }
        } else if (typeof value === 'object' && value !== null) {
          return value.address || value.ip || value;
        }
        return value;
      
      default:
        return value;
    }
  }

  applyFieldRule(sourceObject: any, rule: FieldRule, lookupTables?: Record<string, Record<string, any>>): any {
    let value;
    
    if (rule.source) {
      value = get(sourceObject, rule.source);
    } else if (rule.defaultValue !== undefined) {
      value = rule.defaultValue;
    } else {
      value = undefined;
    }

    if (value === undefined && rule.required && rule.defaultValue !== undefined) {
      value = rule.defaultValue;
    }

    if (value !== undefined && rule.transforms && rule.transforms.length > 0) {
      const transformsWithTables = rule.transforms.map(t => ({
        ...t,
        params: { ...t.params, lookupTables }
      }));
      value = this.applyTransforms(value, transformsWithTables);
    }

    return value;
  }

  transformObject(sourceObject: any, rules: MappingRules): any {
    const targetObject: any = {};

    for (const fieldRule of rules.fields) {
      const value = this.applyFieldRule(sourceObject, fieldRule, rules.lookupTables);
      
      if (value !== undefined) {
        set(targetObject, fieldRule.target, value);
      }
    }

    return targetObject;
  }

  resolveConflicts(
    providerValue: any,
    cmdbValue: any,
    fieldPath: string,
    rules: MappingRules
  ): any {
    const fieldRule = rules.fields.find(f => f.target === fieldPath);
    const policy = fieldRule?.conflictPolicy 
      || rules.conflicts?.fieldPolicies?.[fieldPath]
      || rules.conflicts?.defaultPolicy
      || 'provider-wins';

    switch (policy) {
      case 'provider-wins':
        return providerValue;
      
      case 'cmdb-wins':
        return cmdbValue !== undefined ? cmdbValue : providerValue;
      
      case 'manual-only':
        return cmdbValue !== undefined ? cmdbValue : providerValue;
      
      case 'merge':
        if (Array.isArray(providerValue) && Array.isArray(cmdbValue)) {
          return Array.from(new Set([...cmdbValue, ...providerValue]));
        } else if (typeof providerValue === 'object' && typeof cmdbValue === 'object') {
          return { ...cmdbValue, ...providerValue };
        }
        return providerValue !== undefined ? providerValue : cmdbValue;
      
      default:
        return providerValue;
    }
  }

  findMatchingObject(
    transformedObject: any,
    existingObjects: any[],
    matchBy: string[]
  ): any | null {
    if (!matchBy || matchBy.length === 0) {
      return null;
    }

    for (const existing of existingObjects) {
      let matches = true;
      
      for (const matchField of matchBy) {
        const transformedValue = get(transformedObject, matchField);
        const existingValue = get(existing, matchField);
        
        if (transformedValue !== existingValue) {
          matches = false;
          break;
        }
      }
      
      if (matches) {
        return existing;
      }
    }
    
    return null;
  }

  validateObject(object: any, rules: MappingRules): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const fieldRule of rules.fields) {
      if (fieldRule.required) {
        const value = get(object, fieldRule.target);
        if (value === undefined || value === null || value === '') {
          errors.push(`Required field missing: ${fieldRule.target}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export const rulesEngine = new RulesEngine();
