

// segments are passed by reference
export const applySegmentFilter = (segments, trackOptions) => {
  let segmentsFiltered = segments;
  trackOptions.filter.forEach((f) => {
    const field = f['field'];
    const target = f['target'];
    if (f['operator'] === 'is_one_of') {
      segmentsFiltered = segmentsFiltered.filter((segment) =>
        target.includes(segment[field]),
      );
    } else if (f['operator'] === 'has_one_of') {
      segmentsFiltered = segmentsFiltered.filter((segment) => {
        const segmentArr = segment[field];
        const targetArr = target;
        const intersection = segmentArr.filter((value) =>
          targetArr.includes(value),
        );
        return intersection.length > 0;
      });
    } else if (f['operator'] === 'is_between') {
      segmentsFiltered = segmentsFiltered.filter(
        (segment) => segment[field] >= target[0] && segment[field] <= target[1],
      );
    } else if (f['operator'] === 'is_equal') {
      segmentsFiltered = segmentsFiltered.filter(
        (segment) => segment[field] === target,
      );
    }
  });
  return segmentsFiltered;
}
