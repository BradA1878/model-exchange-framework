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

import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcrypt';

/**
 * User role enum
 */
export enum UserRole {
    ADMIN = 'admin',
    PROVIDER = 'provider',
    CONSUMER = 'consumer'
}

/**
 * User document interface
 */
export interface IUser extends Document {
    username: string;
    email: string;
    password: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    role: UserRole;
    avatar?: string;
    isActive: boolean;
    lastLogin?: Date;
    createdAt: Date;
    updatedAt: Date;
    
    // Methods
    comparePassword(candidatePassword: string): Promise<boolean>;
}

/**
 * User schema
 */
const UserSchema = new Schema<IUser>({
    username: { 
        type: String, 
        required: true, 
        unique: true,
        trim: true,
        minlength: 3
    },
    email: { 
        type: String, 
        required: true, 
        unique: true,
        trim: true,
        lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email address']
    },
    password: { 
        type: String, 
        required: true,
        minlength: 8
    },
    firstName: { 
        type: String,
        trim: true
    },
    lastName: { 
        type: String,
        trim: true
    },
    company: { 
        type: String,
        trim: true
    },
    role: { 
        type: String, 
        enum: Object.values(UserRole),
        default: UserRole.CONSUMER
    },
    avatar: { 
        type: String
    },
    isActive: { 
        type: Boolean, 
        default: true
    },
    lastLogin: { 
        type: Date
    },
    createdAt: { 
        type: Date, 
        default: Date.now
    },
    updatedAt: { 
        type: Date, 
        default: Date.now
    }
});

// Create indexes (username and email unique indexes are defined inline in schema)
UserSchema.index({ role: 1 });

// Pre-save middleware to hash password
UserSchema.pre('save', async function(next) {
    // Only hash the password if it has been modified (or is new)
    if (!this.isModified('password')) {
        return next();
    }
    
    try {
        // Generate a salt
        const salt = await bcrypt.genSalt(10);
        
        // Hash the password along with the new salt
        this.password = await bcrypt.hash(this.password, salt);
        
        // Update the updatedAt field
        this.updatedAt = new Date();
        
        next();
    } catch (error) {
        next(error as Error);
    }
});

// Method to compare passwords
UserSchema.methods.comparePassword = async function(candidatePassword: string): Promise<boolean> {
    return bcrypt.compare(candidatePassword, this.password);
};

// Create and export the User model
export const User = mongoose.model<IUser>('User', UserSchema);
