import { describe, it, expect } from 'vitest';
import {
  MIN_PASSWORD_LENGTH, cleanName, displayNameOf, friendlyAuthError, validateEmail, validateSignIn, validateSignUp,
} from '../src/lib/auth-validation';

const good = { name: 'Lina Haddad', email: 'lina@example.com', password: 'longenough1', confirm: 'longenough1' };

describe('validateSignUp (registration form)', () => {
  it('accepts a correct form', () => {
    expect(validateSignUp(good)).toEqual({});
  });
  it('asks for a real name (2 to 50 characters after cleaning spaces)', () => {
    expect(validateSignUp({ ...good, name: ' a ' }).name).toBeDefined();
    expect(validateSignUp({ ...good, name: '   ' }).name).toBeDefined();
    expect(validateSignUp({ ...good, name: 'x'.repeat(51) }).name).toBeDefined();
    expect(validateSignUp({ ...good, name: 'x'.repeat(50) }).name).toBeUndefined();
  });
  it('rejects a bad email', () => {
    for (const email of ['', 'lina', 'lina@', 'lina@example', 'a b@example.com']) {
      expect(validateSignUp({ ...good, email }).email, email).toBeDefined();
    }
  });
  it('needs the minimum password length and a matching confirmation', () => {
    const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validateSignUp({ ...good, password: short, confirm: short }).password).toBeDefined();
    expect(validateSignUp({ ...good, confirm: 'different1' }).confirm).toBeDefined();
  });
  it('reports every wrong field at once', () => {
    const errors = validateSignUp({ name: '', email: 'x', password: '1', confirm: '2' });
    expect(Object.keys(errors).sort()).toEqual(['confirm', 'email', 'name', 'password']);
  });
});

describe('validateSignIn', () => {
  it('needs an email and a password', () => {
    expect(validateSignIn('lina@example.com', 'pw')).toEqual({});
    expect(validateSignIn('', '')).toMatchObject({ email: expect.any(String), password: expect.any(String) });
  });
});

describe('validateEmail / cleanName', () => {
  it('ignores spaces around the email', () => {
    expect(validateEmail('  lina@example.com ')).toBeNull();
  });
  it('collapses repeated spaces in a name', () => {
    expect(cleanName('  Lina    Haddad ')).toBe('Lina Haddad');
  });
});

describe('displayNameOf', () => {
  it('prefers the name given at sign-up, else the part of the email before @', () => {
    expect(displayNameOf({ email: 'lina@example.com', user_metadata: { full_name: '  Lina  Haddad ' } })).toBe('Lina Haddad');
    expect(displayNameOf({ email: 'lina@example.com', user_metadata: {} })).toBe('lina');
    expect(displayNameOf({ email: 'lina@example.com', user_metadata: { full_name: '   ' } })).toBe('lina');
    expect(displayNameOf(null)).toBe('');
  });
});

describe('friendlyAuthError', () => {
  it('turns Supabase messages into clear sentences', () => {
    expect(friendlyAuthError('Invalid login credentials')).toMatch(/wrong/);
    expect(friendlyAuthError('Email not confirmed')).toMatch(/confirmation link/);
    expect(friendlyAuthError('User already registered')).toMatch(/already has an account/);
    expect(friendlyAuthError('Email rate limit exceeded')).toMatch(/Too many/);
    expect(friendlyAuthError('TypeError: Failed to fetch')).toMatch(/Could not reach/);
  });
  it('keeps an unknown message as it is', () => {
    expect(friendlyAuthError('something new')).toBe('something new');
  });
});
