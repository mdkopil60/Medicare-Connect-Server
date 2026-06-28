# 🏥 MediCare Connect - Server

Backend API for MediCare Connect Hospital Appointment & Healthcare Management System.

Built with Node.js, Express.js, MongoDB, Better Auth, JWT and Stripe.

---

# 🌐 Live API


---

# 🚀 Features

## Authentication

- Better Auth
- JWT Verification
- Role-Based Authorization
- Secure Cookies

---

## User API

- Register User
- Login User
- Get Current User
- Update Profile
- Delete User

---

## Doctor API

- Add Doctor
- Update Doctor
- Delete Doctor
- Verify Doctor
- Reject Verification
- Get All Doctors
- Get Single Doctor

---

## Appointment API

- Book Appointment
- Reschedule Appointment
- Cancel Appointment
- Accept Appointment
- Reject Appointment
- Complete Appointment

---

## Review API

- Add Review
- Update Review
- Delete Review
- Get Reviews

---

## Prescription API

- Create Prescription
- Update Prescription
- Get Prescription

---

## Payment API

- Stripe Payment Intent
- Payment Success
- Store Payment History
- Transaction Records

---

## Dashboard API

### Patient

- Overview
- Appointment History
- Payment History

### Doctor

- Today's Appointment
- Reviews
- Patient Count

### Admin

- Analytics
- User Management
- Doctor Verification
- Appointment Monitoring

---

# 🔒 Security

- JWT Authentication
- Role Verification
- Protected Routes
- MongoDB Validation
- Environment Variables
- CORS Protection
- Error Handling

---

# 🛠 Tech Stack

- Node.js
- Express.js
- MongoDB
- Better Auth
- JWT
- Stripe
- dotenv
- Cors

---

# 📂 Database Collections

## Users

- name
- email
- role
- photo
- gender
- phone
- status

---

## Doctors

- doctorName
- specialization
- qualifications
- experience
- consultationFee
- hospitalName
- profileImage
- availableDays
- availableSlots
- verificationStatus

---

## Appointments

- patientId
- doctorId
- appointmentDate
- appointmentTime
- appointmentStatus
- paymentStatus
- symptoms

---

## Reviews

- patientId
- doctorId
- rating
- reviewText

---

## Payments

- appointmentId
- patientId
- doctorId
- amount
- transactionId

---

## Prescriptions

- doctorId
- patientId
- appointmentId
- diagnosis
- medications
- notes

---

# 🔑 Environment Variables

Create `.env`

```env
PORT=

DATABASE_URL=

BETTER_AUTH_SECRET=

BETTER_AUTH_URL=

JWT_SECRET=

STRIPE_SECRET_KEY=

CLIENT_URL=
```

---

# ⚙ Installation

```bash
git clone https://github.com/mdkopil60/Medicare-Connect-Server

cd medicare-server

npm install

```

---

# 📌 API Endpoints

## Authentication

```
POST   /api/auth/login

POST   /api/auth/register

GET    /api/auth/session
```

---

## Doctors

```
GET     /api/doctors

GET     /api/doctors/:id

POST    /api/doctors

PATCH   /api/doctors/:id

DELETE  /api/doctors/:id
```

---

## Appointments

```
GET

POST

PATCH

DELETE
```

---

## Reviews

```
GET

POST

PATCH

DELETE
```

---

## Payments

```
POST /api/create-payment-intent

POST /api/payment-success
```

---

## Prescriptions

```
GET

POST

PATCH
```

---

# 🔐 JWT Authorization

Protected APIs require:

```
Authorization: Bearer <token>
```

Roles Supported

- Patient
- Doctor
- Admin

---

# 👨‍💻 Developed By

Kopil Uddin
