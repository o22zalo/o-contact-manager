'use strict';

const { parseQueryParams, validateQueryParams } = require('../functions/utils/pagination');

describe('validateQueryParams()', () => {
  test('cho phép query không filter với sort linh hoạt', () => {
    const params = parseQueryParams({ sort: 'displayName', order: 'asc' });
    expect(() => validateQueryParams(params)).not.toThrow();
  });

  test('chặn filtered query dùng sort/order không hỗ trợ', () => {
    const params = parseQueryParams({ category: 'friends', sort: 'displayName', order: 'asc' });
    expect(() => validateQueryParams(params)).toThrow(
      'Filtered queries currently support only sort=updatedAt&order=desc'
    );
  });

  test('cho phép filtered query với updatedAt desc', () => {
    const params = parseQueryParams({ category: 'friends', sort: 'updatedAt', order: 'desc' });
    expect(() => validateQueryParams(params)).not.toThrow();
  });
});
