'use strict';

/**
 * Calculate age from date_of_birth. Returns null if dob is invalid/null.
 * Uses simple year-difference with month/day adjustment.
 */
const calculateAge = (dateOfBirth, now = new Date()) => {
  if (!dateOfBirth) return null;
  let dob;
  if (typeof dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth.trim())) {
    const [year, month, day] = dateOfBirth.trim().split('-').map(Number);
    dob = new Date(year, month - 1, day);
  } else {
    dob = new Date(dateOfBirth);
  }
  if (isNaN(dob.getTime())) return null;
  const today = new Date(now);
  if (isNaN(today.getTime())) return null;

  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
};

/**
 * COPPA under-13 check. Returns true if the student is under 13,
 * false if 13+, null if dob is missing/invalid.
 */
const isUnder13 = (dateOfBirth, now = new Date()) => {
  const age = calculateAge(dateOfBirth, now);
  if (age === null) return null;
  return age < 13;
};

module.exports = { calculateAge, isUnder13 };
