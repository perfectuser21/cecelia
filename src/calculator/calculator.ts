/**
 * Calculator Core Logic
 * Supports basic operations, chaining, and proper error handling
 */

import {
  Operation,
  CalculatorInput,
  CalculatorResult,
  ChainableCalculator,
} from './types';

/**
 * Validate that a value is a finite number
 */
function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * 编译时枚举穷举性检查
 * 如果添加新操作但忘记更新 switch，TypeScript 会报错
 */
function assertNever(x: never): never {
  throw new Error(`Unexpected operation: ${x}`);
}

/**
 * Perform a single calculation
 */
export function calculate(input: CalculatorInput): CalculatorResult {
  const { a, b, operation } = input;

  // 运行时数字验证
  if (!isValidNumber(a)) {
    return {
      success: false,
      value: NaN,
      error: `Invalid input: 'a' is not a finite number (got ${typeof a === 'number' ? a : typeof a})`,
      input,
    };
  }
  if (!isValidNumber(b)) {
    return {
      success: false,
      value: NaN,
      error: `Invalid input: 'b' is not a finite number (got ${typeof b === 'number' ? b : typeof b})`,
      input,
    };
  }

  let value: number;

  switch (operation) {
    case Operation.ADD:
      value = a + b;
      break;
    case Operation.SUB:
      value = a - b;
      break;
    case Operation.MUL:
      value = a * b;
      break;
    case Operation.DIV:
      if (b === 0) {
        return {
          success: false,
          value: NaN,
          error: 'Division by zero',
          input,
        };
      }
      value = a / b;
      break;
    case Operation.POW:
      value = Math.pow(a, b);
      break;
    default:
      // 编译时穷举性检查：如果添加新操作但忘记处理，这里会报类型错误
      return assertNever(operation);
  }

  // Handle special numeric cases (Infinity, -Infinity, NaN from operations like sqrt of negative)
  if (!Number.isFinite(value)) {
    return {
      success: false,
      value,
      error: 'Result is not finite',
      input,
    };
  }

  return {
    success: true,
    value,
    input,
  };
}

/**
 * Create a chainable calculator starting from an initial value
 *
 * 设计说明：
 * - 错误后继续操作：一旦发生错误（如除以零），后续操作仍可继续但值为 NaN
 * - 错误记录：只记录第一个错误，因为后续错误通常是连锁反应
 * - result().input：返回最后一次操作的输入，如无操作则返回初始值
 */
export function chain(initialValue: number): ChainableCalculator {
  let currentValue = initialValue;
  let firstError: string | undefined;
  let lastInput: CalculatorInput = { a: initialValue, b: 0, operation: Operation.ADD };
  let hasOperations = false;

  // Validate initial value
  if (!Number.isFinite(initialValue)) {
    firstError = 'Initial value is not finite';
  }

  const performOp = (n: number, operation: Operation): void => {
    hasOperations = true;
    const input: CalculatorInput = { a: currentValue, b: n, operation };
    lastInput = input;

    // 如果已经出错（currentValue 是 NaN），跳过计算但记录操作
    if (!Number.isFinite(currentValue)) {
      return;
    }

    const result = calculate(input);
    if (!result.success && !firstError) {
      firstError = result.error;
    }
    currentValue = result.value;
  };

  const calculator: ChainableCalculator = {
    get value() {
      return currentValue;
    },

    add(n: number): ChainableCalculator {
      performOp(n, Operation.ADD);
      return calculator;
    },

    sub(n: number): ChainableCalculator {
      performOp(n, Operation.SUB);
      return calculator;
    },

    mul(n: number): ChainableCalculator {
      performOp(n, Operation.MUL);
      return calculator;
    },

    div(n: number): ChainableCalculator {
      performOp(n, Operation.DIV);
      return calculator;
    },

    pow(n: number): ChainableCalculator {
      performOp(n, Operation.POW);
      return calculator;
    },

    result(): CalculatorResult {
      const success = Number.isFinite(currentValue) && !firstError;
      return {
        success,
        value: currentValue,
        error: firstError,
        input: hasOperations ? lastInput : { a: initialValue, b: 0, operation: Operation.ADD },
      };
    },
  };

  return calculator;
}
