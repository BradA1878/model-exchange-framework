/**
 * Copyright 2024 Brad Anderson
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @author Brad Anderson <BradA1878@pm.me>
 * @repository https://github.com/BradA1878/model-exchange-framework
 * @documentation https://mxf-dev.github.io/mxf/
 */

import { Request, Response } from 'express';
import crypto from 'crypto';
import { User, UserRole } from '@mxf-dev/core/models/user';
import { Logger } from '@mxf-dev/core/utils/Logger';
import { getMagicLinkSender, buildMagicLinkUrl } from '../services/MagicLinkSender';
import {
    signMagicLinkToken,
    signSessionToken,
    verifyMagicLinkToken
} from '../security/jwtTokenPolicy';
import { userSessionLifecycle } from '../../socket/services/UserSessionLifecycle';

/**
 * User controller for handling user-related operations
 */
const logger = new Logger('info', 'UserController', 'server');

/** Magic-link token lifetime, in minutes. */
const MAGIC_LINK_EXPIRY_MINUTES = 15;

const hashMagicLinkNonce = (nonce: string): string =>
    crypto.createHash('sha256').update(nonce).digest('hex');

/**
 * Generate JWT token for authentication
 * @param userId - User ID to include in token
 * @param role - User role
 * @returns JWT token string
 */
const generateToken = (userId: string, role: string): string => signSessionToken(userId, role);

/**
 * Narrow a value from the request body to a plain string.
 *
 * Mongo query values are interpolated straight into filters such as
 * `{ $or: [{ username }, { email: username }] }`. JSON bodies can carry objects,
 * so a body of `{"username": {"$gt": ""}}` would otherwise become a query
 * operator and match the first user in the collection. Anything that is not a
 * string is rejected before it reaches the query.
 *
 * @param value - Raw value from req.body
 * @returns The trimmed string, or null when the value is not a non-empty string
 */
const asIdentifier = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

export const userController = {
    /**
     * Register a new user
     *
     * Self-registration always creates a CONSUMER. `role` is never read from the
     * request body — UserRole.ADMIN is a valid enum value, so honouring a
     * client-supplied role would let anyone register as an administrator.
     * Roles are changed only through updateUserRole, which is admin-gated.
     */
    register: async (req: Request, res: Response): Promise<void> => {
        try {
            const { password, firstName, lastName, company } = req.body;

            // Reject non-string identifiers before they reach the Mongo query
            const username = asIdentifier(req.body?.username);
            const email = asIdentifier(req.body?.email);

            if (!username || !email) {
                res.status(400).json({
                    success: false,
                    message: 'Username and email are required and must be strings'
                });
                return;
            }

            if (typeof password !== 'string' || password.length === 0) {
                res.status(400).json({
                    success: false,
                    message: 'Password is required and must be a string'
                });
                return;
            }

            // Check if user already exists
            const existingUser = await User.findOne({
                $or: [{ username }, { email }]
            });

            if (existingUser) {
                res.status(400).json({
                    success: false,
                    message: 'User already exists with this username or email'
                });
                return;
            }

            // Create new user — role is fixed, never taken from the request
            const user = new User({
                username,
                email,
                password,
                firstName,
                lastName,
                company,
                role: UserRole.CONSUMER
            });

            await user.save();
            
            // Generate auth token
            const token = generateToken(user._id?.toString() || '', user.role);
            
            // Return user data (excluding password)
            const userData = {
                id: user._id,
                username: user.username,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                company: user.company,
                role: user.role
            };
            
            res.status(201).json({
                success: true,
                message: 'User registered successfully',
                user: userData,
                token
            });
        } catch (error) {
            logger.error('User registration error:', error);
            res.status(500).json({
                success: false,
                message: 'Error registering user'
            });
        }
    },
    
    /**
     * User login
     */
    login: async (req: Request, res: Response): Promise<void> => {
        try {
            const { password } = req.body;

            // Reject non-string identifiers before they reach the Mongo query.
            // A body of {"username": {"$gt": ""}} would otherwise be interpolated
            // as a query operator and match the first user in the collection.
            const username = asIdentifier(req.body?.username);

            if (!username || typeof password !== 'string' || password.length === 0) {
                res.status(401).json({
                    success: false,
                    message: 'Invalid credentials'
                });
                return;
            }

            // Find user by username or email
            const user = await User.findOne({
                $or: [{ username }, { email: username }]
            });

            if (!user) {
                res.status(401).json({
                    success: false,
                    message: 'Invalid credentials'
                });
                return;
            }

            // Check password
            const isMatch = await user.comparePassword(password);

            if (!isMatch) {
                res.status(401).json({
                    success: false,
                    message: 'Invalid credentials'
                });
                return;
            }
            
            // Update last login time
            user.lastLogin = new Date();
            await user.save();
            
            // Generate auth token for the user
            const token = generateToken(user._id?.toString() || '', user.role);
            
            // Return user data (excluding password)
            const userData = {
                id: user._id,
                username: user.username,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                company: user.company,
                role: user.role,
                avatar: user.avatar
            };
            
            res.status(200).json({
                success: true,
                message: 'Login successful',
                user: userData,
                token
            });
        } catch (error) {
            logger.error('User login error:', error);
            res.status(500).json({
                success: false,
                message: 'Error during login'
            });
        }
    },
    
    /**
     * Get user profile
     */
    getProfile: async (req: Request, res: Response): Promise<void> => {
        try {
            // Check if user is authenticated (should be set by dual auth middleware)
            const user = (req as any).user;
            if (!user || !user.id) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }
            
            const userId = user.id;
            
            const userData = await User.findById(userId).select('-password');
            
            if (!userData) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }
            
            res.status(200).json({
                success: true,
                user: userData
            });
        } catch (error) {
            logger.error('Get profile error:', error);
            res.status(500).json({
                success: false,
                message: 'Error retrieving user profile'
            });
        }
    },
    
    /**
     * Update user profile
     */
    updateProfile: async (req: Request, res: Response): Promise<void> => {
        try {
            // Check if user is authenticated (should be set by dual auth middleware)
            const user = (req as any).user;
            if (!user || !user.id) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }
            
            const userId = user.id;
            const { firstName, lastName, email, company, avatar } = req.body;
        
            const userData = await User.findById(userId);
            
            if (!userData) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }
            
            // Check if email is being changed and if it's already in use
            if (email && email !== userData.email) {
                const existingUser = await User.findOne({ email });
                if (existingUser) {
                    res.status(400).json({
                        success: false,
                        message: 'Email address is already in use'
                    });
                    return;
                }
            }
            
            // Update user fields
            if (firstName) userData.firstName = firstName;
            if (lastName) userData.lastName = lastName;
            if (email) userData.email = email;
            if (company) userData.company = company;
            if (avatar) userData.avatar = avatar;
            
            await userData.save();
            
            res.status(200).json({
                success: true,
                message: 'Profile updated successfully',
                user: {
                    id: userData._id,
                    username: userData.username,
                    email: userData.email,
                    firstName: userData.firstName,
                    lastName: userData.lastName,
                    company: userData.company,
                    role: userData.role,
                    avatar: userData.avatar
                }
            });
        } catch (error) {
            logger.error('Update profile error:', error);
            res.status(500).json({
                success: false,
                message: 'Error updating user profile'
            });
        }
    },
    
    /**
     * Get all users (admin only)
     */
    getAllUsers: async (req: Request, res: Response): Promise<void> => {
        try {
            // Check if user is authenticated (should be set by dual auth middleware)
            const user = (req as any).user;
            if (!user || !user.role) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }
            
            // Check if user is admin
            const userRole = user.role;
            
            if (userRole !== UserRole.ADMIN) {
                res.status(403).json({
                    success: false,
                    message: 'Unauthorized: Admin access required'
                });
                return;
            }
            
            const users = await User.find().select('-password');
            
            // Map MongoDB _id to id for frontend compatibility
            const mappedUsers = users.map(user => ({
                id: (user as any)._id.toString(),
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                company: user.company,
                role: user.role,
                avatar: user.avatar,
                isActive: user.isActive,
                lastLogin: user.lastLogin,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
            }));
            
            res.status(200).json({
                success: true,
                users: mappedUsers
            });
        } catch (error) {
            logger.error('Get all users error:', error);
            res.status(500).json({
                success: false,
                message: 'Error retrieving users'
            });
        }
    },
    
    /**
     * Update user role (admin only)
     */
    updateUserRole: async (req: Request, res: Response): Promise<void> => {
        try {
            // Check if user is authenticated (should be set by dual auth middleware)
            const user = (req as any).user;
            if (!user || !user.role) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }
            
            // Check if user is admin
            const userRole = user.role;
            
            if (userRole !== UserRole.ADMIN) {
                res.status(403).json({
                    success: false,
                    message: 'Unauthorized: Admin access required'
                });
                return;
            }
            
            const { role } = req.body;
            const targetUserId = asIdentifier(req.body?.userId);
            
            if (!targetUserId || !Object.values(UserRole).includes(role as UserRole)) {
                res.status(400).json({
                    success: false,
                    message: 'A valid userId and role are required'
                });
                return;
            }

            const userData = await userSessionLifecycle.runUserAuthorizationMutation(
                targetUserId,
                async () => {
                    const currentUser = await User.findById(targetUserId);
                    if (!currentUser) {
                        return null;
                    }

                    const roleChanged = currentUser.role !== role;
                    currentUser.role = role as UserRole;
                    await currentUser.save();

                    if (roleChanged) {
                        // Socket handlers capture role at authentication time. Eviction
                        // is part of the mutation: never report a successful role change
                        // while stale JWT/password/PAT forwarding remains active.
                        await userSessionLifecycle.disconnectUserSessions(String(currentUser._id));
                    }
                    return currentUser;
                }
            );
            
            if (!userData) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }
            
            res.status(200).json({
                success: true,
                message: 'User role updated successfully'
            });
        } catch (error) {
            logger.error('Update user role error:', error);
            res.status(500).json({
                success: false,
                message: 'Error updating user role'
            });
        }
    },

    /**
     * Activate or deactivate a user account (admin only).
     *
     * Deactivation is an authorization mutation, not just profile metadata:
     * every already-authenticated user socket must be evicted before success is
     * returned so an inactive administrator cannot retain privileged handlers.
     */
    updateUserStatus: async (req: Request, res: Response): Promise<void> => {
        try {
            const requester = (req as Request & {
                user?: { id?: string; role?: UserRole };
            }).user;
            if (!requester?.id || requester.role !== UserRole.ADMIN) {
                res.status(requester?.id ? 403 : 401).json({
                    success: false,
                    message: requester?.id
                        ? 'Unauthorized: Admin access required'
                        : 'Authentication required'
                });
                return;
            }

            const userId = asIdentifier(req.body?.userId);
            const isActive = req.body?.isActive;
            if (!userId || typeof isActive !== 'boolean') {
                res.status(400).json({
                    success: false,
                    message: 'userId and boolean isActive are required'
                });
                return;
            }

            const userData = await userSessionLifecycle.runUserAuthorizationMutation(
                userId,
                async () => {
                    const currentUser = await User.findById(userId);
                    if (!currentUser) {
                        return null;
                    }

                    const statusChanged = currentUser.isActive !== isActive;
                    currentUser.isActive = isActive;
                    await currentUser.save();

                    // Always sweep an inactive account, even if it was already marked
                    // inactive, so this operation can repair a previously missed local
                    // eviction. Activation only needs a sweep when state changes.
                    if (!isActive || statusChanged) {
                        await userSessionLifecycle.disconnectUserSessions(String(currentUser._id));
                    }
                    return currentUser;
                }
            );
            if (!userData) {
                res.status(404).json({ success: false, message: 'User not found' });
                return;
            }

            res.status(200).json({
                success: true,
                message: isActive ? 'User activated successfully' : 'User deactivated successfully'
            });
        } catch (error) {
            logger.error('Update user status error:', error);
            res.status(500).json({
                success: false,
                message: 'Error updating user status'
            });
        }
    },

    /**
     * Request magic link for authentication
     *
     * The magic-link token is a bearer credential: /magic-link/verify exchanges
     * it for a 24h session. It is therefore delivered out of band by the
     * configured MagicLinkSender and never returned in this response — returning
     * it would let any unauthenticated caller take over any account by asking
     * for a link to that address.
     *
     * Unknown addresses still auto-create an account, but the response is
     * identical either way so it cannot be used to enumerate registered users.
     */
    requestMagicLink: async (req: Request, res: Response): Promise<void> => {
        try {
            // Validate email format up front — magic link auto-creates a user,
            // so a malformed address would otherwise fail Mongoose validation
            // deep in save() and surface as a confusing 500. The typeof check
            // also keeps query operators out of the User.findOne filter.
            const email = asIdentifier(req.body?.email);
            const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

            if (!email || !EMAIL_PATTERN.test(email)) {
                res.status(400).json({
                    success: false,
                    message: 'A valid email address is required'
                });
                return;
            }

            // Resolve the transport before creating anything. In production with no
            // transport configured this throws, so we never mint a token we cannot
            // deliver and never report success for a link that went nowhere.
            const sender = getMagicLinkSender();

            // Find existing user or auto-create a new one
            let user = await User.findOne({ email });
            let isNewUser = false;

            if (!user) {
                // Auto-create user from email address
                // Derive username from email local part, ensure uniqueness
                const localPart = email.split('@')[0];
                let username = localPart;
                let suffix = 0;
                while (await User.findOne({ username })) {
                    suffix++;
                    username = `${localPart}${suffix}`;
                }

                // Generate a random password (user authenticates via magic link, not password)
                const randomPassword = crypto.randomBytes(32).toString('hex');

                user = new User({
                    username,
                    email,
                    password: randomPassword,
                    role: UserRole.CONSUMER
                });
                await user.save();
                isNewUser = true;
                logger.info(`Auto-created new user '${username}' via magic link for ${email}`);
            }

            // Store only a digest of a random nonce. Verification consumes it
            // with one atomic update, making every link single-use even when
            // two exchange requests race each other.
            const magicLinkNonce = crypto.randomBytes(32).toString('base64url');
            const magicLinkNonceHash = hashMagicLinkNonce(magicLinkNonce);
            const magicLinkExpiresAt = new Date(
                Date.now() + MAGIC_LINK_EXPIRY_MINUTES * 60 * 1000
            );
            await User.updateOne(
                { _id: user._id },
                {
                    $set: {
                        magicLinkNonceHash,
                        magicLinkExpiresAt
                    }
                }
            );

            // Generate magic link token (JWT with short expiry)
            const magicToken = signMagicLinkToken(
                user._id?.toString() || '',
                user.email,
                magicLinkNonce,
                MAGIC_LINK_EXPIRY_MINUTES
            );

            // Deliver out of band. A delivery failure throws and surfaces as a 500 —
            // it must not be reported as success.
            try {
                await sender.send({
                    email: user.email,
                    magicLink: buildMagicLinkUrl(magicToken),
                    token: magicToken,
                    expiresInMinutes: MAGIC_LINK_EXPIRY_MINUTES,
                    isNewUser
                });
            } catch (error) {
                // A failed delivery must not leave a usable bearer credential.
                // Match the digest so a newer concurrent request is not erased.
                await User.updateOne(
                    { _id: user._id, magicLinkNonceHash },
                    { $unset: { magicLinkNonceHash: '', magicLinkExpiresAt: '' } }
                );
                throw error;
            }

            // Identical response for known and unknown addresses, and no token.
            res.status(200).json({
                success: true,
                message: 'If that address can receive mail, a sign-in link is on its way',
                expiresIn: `${MAGIC_LINK_EXPIRY_MINUTES} minutes`
            });
        } catch (error) {
            logger.error('Magic link request error:', error);
            res.status(500).json({
                success: false,
                message: 'Error sending magic link'
            });
        }
    },

    /**
     * Verify magic link token and authenticate user
     */
    verifyMagicLink: async (req: Request, res: Response): Promise<void> => {
        
        try {
            const { token } = req.body;
            
            if (!token) {
                res.status(400).json({
                    success: false,
                    message: 'Magic link token is required'
                });
                return;
            }
            
            // Verify the magic link token
            let decoded;
            
            try {
                decoded = verifyMagicLinkToken(token);
            } catch (jwtError) {
                res.status(401).json({
                    success: false,
                    message: 'Invalid or expired magic link token'
                });
                return;
            }
            
            // Atomically consume the nonce. Exactly one concurrent or replayed
            // exchange can match; inactive users cannot mint new sessions.
            const now = new Date();
            const user = await User.findOneAndUpdate(
                {
                    _id: decoded.userId,
                    email: decoded.email,
                    isActive: true,
                    magicLinkNonceHash: hashMagicLinkNonce(decoded.jti),
                    magicLinkExpiresAt: { $gt: now }
                },
                {
                    $unset: { magicLinkNonceHash: '', magicLinkExpiresAt: '' },
                    $set: { lastLogin: now }
                },
                { new: true }
            );
            
            if (!user) {
                res.status(401).json({
                    success: false,
                    message: 'Invalid or expired magic link token'
                });
                return;
            }
            
            // Generate new auth token for session
            const authToken = generateToken(user._id?.toString() || '', user.role);
            
            // Return user data and auth token
            const userData = {
                id: user._id,
                username: user.username,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                company: user.company,
                role: user.role,
                avatar: user.avatar
            };

            // Profile is complete when user has both first and last name set
            const profileComplete = !!(user.firstName && user.lastName);

            res.status(200).json({
                success: true,
                message: 'Authentication successful',
                user: userData,
                token: authToken,
                profileComplete
            });
        } catch (error) {
            logger.error('Magic link verification error:', error);
            res.status(500).json({
                success: false,
                message: 'Error verifying magic link'
            });
        }
    },

    /**
     * Delete user profile (self-deletion)
     */
    deleteProfile: async (req: Request, res: Response): Promise<void> => {
        try {
            // Check if user is authenticated (should be set by dual auth middleware)
            const user = (req as any).user;
            if (!user || !user.id) {
                res.status(401).json({
                    success: false,
                    message: 'Authentication required'
                });
                return;
            }
            
            const userId = asIdentifier(user.id);
            if (!userId) {
                res.status(401).json({ success: false, message: 'Authentication required' });
                return;
            }

            const userData = await userSessionLifecycle.runUserAuthorizationMutation(
                userId,
                async () => {
                    // Find and delete the user
                    const deletedUser = await User.findByIdAndDelete(userId);
                    if (!deletedUser) {
                        return null;
                    }

                    // Deleted/inactive users cannot authenticate again, but already-
                    // authenticated sockets retain installed handlers until explicitly
                    // evicted. Treat local eviction failure as an operation failure.
                    await userSessionLifecycle.disconnectUserSessions(String(deletedUser._id));
                    return deletedUser;
                }
            );
            
            if (!userData) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }

            res.status(200).json({
                success: true,
                message: 'User profile deleted successfully'
            });
        } catch (error) {
            logger.error('Delete profile error:', error);
            res.status(500).json({
                success: false,
                message: 'Error deleting user profile'
            });
        }
    }
};
