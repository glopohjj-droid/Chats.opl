export interface Message {
  id: string;
  text: string;
  userId: string;
  userName: string;
  userPhoto?: string;
  createdAt: any; // Firestore Timestamp
  isAi?: boolean;
  thinkingText?: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL?: string;
  email: string;
  createdAt: any; // Firestore Timestamp
}
