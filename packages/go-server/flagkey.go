package savvagentflags

import "errors"

// ErrInvalidFlagKey is returned (wrapped) by Evaluate when the flag key is
// not a valid flag key. No request is made in that case.
var ErrInvalidFlagKey = errors.New("savvagent flags: invalid flag key")

// isValidFlagKey reports whether key is 1-128 ASCII letters, digits, '-', '_'
// or '.', and is not "." or "..". This mirrors the server's key rule. The key
// is interpolated into the evaluate URL path, and "." and ".." cannot be
// carried in a URL path (clients normalize them away), while '/', '?' and '#'
// would steer the request, and the SDK key with it, to another endpoint (#107).
func isValidFlagKey(key string) bool {
	if len(key) == 0 || len(key) > 128 || key == "." || key == ".." {
		return false
	}
	for i := 0; i < len(key); i++ {
		b := key[i]
		switch {
		case b >= 'a' && b <= 'z', b >= 'A' && b <= 'Z', b >= '0' && b <= '9',
			b == '-', b == '_', b == '.':
		default:
			return false
		}
	}
	return true
}
