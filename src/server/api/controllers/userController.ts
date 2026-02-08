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
 * @documentation https://brada1878.github.io/model-exchange-framework/
 */

import { Request, Response } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { User, UserRole } from '../../../shared/models/user';
import { Logger } from '../../../shared/utils/Logger';

/**
 * User controller for handling user-related operations
 */
const logger = new Logger('info', 'UserController', 'server');

/**
 * Generate JWT token for authentication
 * @param userId - User ID to include in token
 * @param type - Token type (e.g., 'user', 'admin')
 * @param role - User role
 * @returns JWT token string
 */
const generateToken = (userId: string, type: string, role: string): string => {
    const secret = process.env.JWT_SECRET || 'default_jwt_secret_for_dev';
    return jwt.sign(
        { userId, type, role },
        secret,
        { expiresIn: '24h' }
    );
};

export const userController = {
    /**
     * Register a new user
     */
    register: async (req: Request, res: Response): Promise<void> => {
        try {
            const { username, email, password, firstName, lastName, company, role } = req.body;
            
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
            
            // Create new user
            const user = new User({
                username,
                email,
                password,
                firstName,
                lastName,
                company,
                role: role || UserRole.CONSUMER
            });
            
            await user.save();
            
            // Generate auth token
            const token = generateToken(user._id?.toString() || '', 'user', user.role);
            
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
            const { username, password } = req.body;
            
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
            const token = generateToken(user._id?.toString() || '', 'user', user.role);
            
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
            
            const { userId, role } = req.body;
            
            if (!Object.values(UserRole).includes(role as UserRole)) {
                res.status(400).json({
                    success: false,
                    message: 'Invalid role specified'
                });
                return;
            }
            
            const userData = await User.findById(userId);
            
            if (!userData) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }
            
            userData.role = role as UserRole;
            await userData.save();
            
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
     * Request magic link for authentication
     */
    requestMagicLink: async (req: Request, res: Response): Promise<void> => {
        try {
            const { email } = req.body;

            if (!email) {
                res.status(400).json({
                    success: false,
                    message: 'Email is required'
                });
                return;
            }

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

            // Generate magic link token (JWT with short expiry)
            const secret = process.env.JWT_SECRET || 'default_jwt_secret_for_dev';
            const magicToken = jwt.sign(
                { userId: user._id?.toString(), email: user.email, type: 'magic_link' },
                secret,
                { expiresIn: '15m' } // 15 minutes expiry
            );

            // In production, this would send an email
            // For development, return the token directly
            res.status(200).json({
                success: true,
                message: isNewUser
                    ? 'Account created and magic link generated successfully'
                    : 'Magic link generated successfully',
                isNewUser,
                // For development only - remove in production
                magicLink: magicToken,
                expiresIn: '15 minutes'
            });
        } catch (error) {
            logger.error('Magic link request error:', error);
            res.status(500).json({
                success: false,
                message: 'Error generating magic link'
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
            const secret = process.env.JWT_SECRET || 'default_jwt_secret_for_dev';
            let decoded: any;
            
            try {
                decoded = jwt.verify(token, secret);
            } catch (jwtError) {
                res.status(401).json({
                    success: false,
                    message: 'Invalid or expired magic link token'
                });
                return;
            }
            
            // Validate token type
            if (decoded.type !== 'magic_link') {
                res.status(401).json({
                    success: false,
                    message: 'Invalid token type'
                });
                return;
            }
            
            // Find user by ID from token
            const user = await User.findById(decoded.userId);
            
            if (!user) {
                res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
                return;
            }
            
            // Update last login time
            user.lastLogin = new Date();
            await user.save();
            
            // Generate new auth token for session
            const authToken = generateToken(user._id?.toString() || '', 'user', user.role);
            
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
            
            const userId = user.id;
            
            // Find and delete the user
            const userData = await User.findByIdAndDelete(userId);
            
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
