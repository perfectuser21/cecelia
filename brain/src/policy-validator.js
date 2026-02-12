/**
 * Policy Validator - Immune System P2
 *
 * Validates absorption policy JSON format and enforces schema requirements.
 * Supports 4 action types: requeue, skip, adjust_params, kill.
 *
 * @module policy-validator
 */

// Allowed action types
export const ALLOWED_ACTIONS = ['requeue', 'skip', 'adjust_params', 'kill'];

// Action-specific parameter schemas
export const ACTION_PARAMS_SCHEMA = {
  requeue: {
    required: ['delay_minutes'],
    optional: ['priority'],
    defaults: { priority: 'normal' }
  },
  skip: {
    required: [],
    optional: ['reason'],
    defaults: { reason: 'No reason provided' }
  },
  adjust_params: {
    required: ['adjustments'],
    optional: ['merge_strategy'],
    defaults: { merge_strategy: 'merge' }
  },
  kill: {
    required: ['reason'],
    optional: ['notify'],
    defaults: {}
  }
};

/**
 * Check if an action is valid
 * @param {string} action - Action type to validate
 * @returns {boolean} True if action is valid
 */
export function isValidAction(action) {
  return ALLOWED_ACTIONS.includes(action);
}

/**
 * Get required parameters for an action
 * @param {string} action - Action type
 * @returns {string[]} Array of required parameter names
 */
export function getRequiredParams(action) {
  const schema = ACTION_PARAMS_SCHEMA[action];
  return schema ? schema.required : [];
}

/**
 * Validate policy JSON against schema
 *
 * @param {Object|string} policyJson - Policy JSON object or string
 * @param {Object} options - Validation options
 * @param {boolean} options.strict - Strict mode (reject confidence < 0.5)
 * @returns {Object} Validation result
 * @returns {boolean} result.valid - Whether policy is valid
 * @returns {Array<{field: string, message: string}>} result.errors - Validation errors
 * @returns {Array<{field: string, message: string}>} result.warnings - Validation warnings
 * @returns {Object|null} result.normalized - Normalized policy with defaults applied
 */
export function validatePolicyJson(policyJson, options = {}) {
  const { strict = true } = options;
  const errors = [];
  const warnings = [];

  // Handle string input
  let policy;
  if (typeof policyJson === 'string') {
    try {
      policy = JSON.parse(policyJson);
    } catch (err) {
      return {
        valid: false,
        errors: [{ field: 'json', message: 'Invalid JSON: ' + err.message }],
        warnings: [],
        normalized: null
      };
    }
  } else if (typeof policyJson === 'object' && policyJson !== null) {
    policy = policyJson;
  } else {
    return {
      valid: false,
      errors: [{ field: 'input', message: 'Policy must be object or string' }],
      warnings: [],
      normalized: null
    };
  }

  // Check required fields
  const requiredFields = ['action', 'params', 'expected_outcome', 'confidence', 'reasoning'];
  for (const field of requiredFields) {
    if (!(field in policy)) {
      errors.push({ field, message: `Missing required field: ${field}` });
    }
  }

  // If missing required fields, stop here
  if (errors.length > 0) {
    return { valid: false, errors, warnings, normalized: null };
  }

  // Validate action type
  if (!isValidAction(policy.action)) {
    errors.push({
      field: 'action',
      message: `Invalid action: ${policy.action}. Must be one of: ${ALLOWED_ACTIONS.join(', ')}`
    });
  }

  // Validate params
  if (typeof policy.params !== 'object' || policy.params === null) {
    errors.push({
      field: 'params',
      message: 'params must be an object'
    });
  } else if (isValidAction(policy.action)) {
    const schema = ACTION_PARAMS_SCHEMA[policy.action];

    // Check required params
    for (const param of schema.required) {
      if (!(param in policy.params)) {
        errors.push({
          field: `params.${param}`,
          message: `Missing required param for ${policy.action}: ${param}`
        });
      }
    }

    // Type validation for specific params
    if (policy.action === 'requeue') {
      if ('delay_minutes' in policy.params) {
        if (typeof policy.params.delay_minutes !== 'number' || policy.params.delay_minutes <= 0) {
          errors.push({
            field: 'params.delay_minutes',
            message: 'delay_minutes must be a positive number'
          });
        }
      }
      if ('priority' in policy.params) {
        if (!['high', 'normal', 'low'].includes(policy.params.priority)) {
          errors.push({
            field: 'params.priority',
            message: 'priority must be one of: high, normal, low'
          });
        }
      }
    }

    if (policy.action === 'adjust_params' && 'adjustments' in policy.params) {
      if (typeof policy.params.adjustments !== 'object' || policy.params.adjustments === null) {
        errors.push({
          field: 'params.adjustments',
          message: 'adjustments must be an object'
        });
      }
    }
  }

  // Validate confidence
  if (typeof policy.confidence !== 'number') {
    errors.push({
      field: 'confidence',
      message: 'confidence must be a number'
    });
  } else {
    if (policy.confidence < 0 || policy.confidence > 1) {
      errors.push({
        field: 'confidence',
        message: 'confidence must be between 0 and 1'
      });
    }
    if (policy.confidence < 0.5) {
      if (strict) {
        errors.push({
          field: 'confidence',
          message: 'confidence < 0.5 not allowed in strict mode'
        });
      } else {
        warnings.push({
          field: 'confidence',
          message: 'Low confidence (< 0.5)'
        });
      }
    }
  }

  // Validate reasoning
  if (typeof policy.reasoning !== 'string') {
    errors.push({
      field: 'reasoning',
      message: 'reasoning must be a string'
    });
  } else {
    if (policy.reasoning.trim().length === 0) {
      errors.push({
        field: 'reasoning',
        message: 'reasoning cannot be empty'
      });
    }
    if (policy.reasoning.length < 20) {
      warnings.push({
        field: 'reasoning',
        message: 'reasoning is very short (< 20 chars)'
      });
    }
    if (policy.reasoning.length > 500) {
      warnings.push({
        field: 'reasoning',
        message: 'reasoning is very long (> 500 chars)'
      });
    }
  }

  // Validate expected_outcome
  if (typeof policy.expected_outcome !== 'string') {
    errors.push({
      field: 'expected_outcome',
      message: 'expected_outcome must be a string'
    });
  } else if (policy.expected_outcome.trim().length === 0) {
    errors.push({
      field: 'expected_outcome',
      message: 'expected_outcome cannot be empty'
    });
  }

  // If there are errors, return early
  if (errors.length > 0) {
    return { valid: false, errors, warnings, normalized: null };
  }

  // Normalize: apply defaults
  const normalized = { ...policy };
  if (isValidAction(policy.action)) {
    const schema = ACTION_PARAMS_SCHEMA[policy.action];
    normalized.params = { ...schema.defaults, ...policy.params };
  }

  return {
    valid: true,
    errors: [],
    warnings,
    normalized
  };
}
