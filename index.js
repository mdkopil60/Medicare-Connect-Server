const dns = require('node:dns');
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken'); // Added for JWT Verification
require('dotenv').config();
// Initialize Stripe (Uncommented and uses process.env.STRIPE_SECRET_KEY)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));
app.use(express.json());

const uri = process.env.MONGO_DB_URI;
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
const verifyToken = (req, res, next) => {
    // console.log('headers', req.headers);
    next();
}
async function run() {
    try {
        await client.connect();
        const database = client.db("medicare-connect");
        // All Required Collections
        const usersCollection = database.collection("users");
        const doctorsCollection = database.collection("doctors");
        const appointmentsCollection = database.collection("appointments");
        const reviewsCollection = database.collection("reviews");
        const paymentsCollection = database.collection("payments");
        const prescriptionsCollection = database.collection("prescriptions");

        // ==========================================
        // 🔐 AUTH MIDDLEWARES (JWT & Role Verification)
        // ==========================================

        // 1. Verify JWT Token Token Middleware
        // const verifyToken = (req, res, next) => {
        //     if (!req.headers.authorization) {
        //         return res.status(401).send({ message: 'Unauthorized access' });
        //     }
        //     const token = req.headers.authorization.split(' ')[1];
        //     jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        //         if (err) {
        //             return res.status(403).send({ message: 'Forbidden access' });
        //         }
        //         req.decoded = decoded;
        //         next();
        //     });
        // };

        // // 2. Verify Admin Middleware
        // const verifyAdmin = async (req, res, next) => {
        //     const email = req.decoded.email;
        //     const query = { email: email };
        //     const user = await usersCollection.findOne(query);
        //     if (!user || user?.role !== 'admin') {
        //         return res.status(403).send({ message: 'Forbidden access! Admin only.' });
        //     }
        //     next();
        // };

        // // 3. Verify Doctor Middleware
        // const verifyDoctor = async (req, res, next) => {
        //     const email = req.decoded.email;
        //     const query = { email: email };
        //     const user = await usersCollection.findOne(query);
        //     if (!user || user?.role !== 'doctor') {
        //         return res.status(403).send({ message: 'Forbidden access! Doctor only.' });
        //     }
        //     next();
        // };


        // ==========================================
        // 🎟️ AUTHENTICATION & USERS API
        // ==========================================

        // Create JWT Token
        app.post('/jwt', async (req, res) => {
            const user = req.body;
            const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' });
            res.send({ token });
        });

        // Save or update User info upon Register/Login
        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };
            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: 'User already exists', insertedId: null });
            }
            const result = await usersCollection.insertOne({
                ...user,
                createdAt: new Date(),
                status: 'active'
            });
            res.send(result);
        });

        // Get Single User Role Route
        app.get('/users/role/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            res.send({ role: user?.role || 'patient' });
        });


        // ==========================================
        // 🩺 PUBLIC & FIND DOCTORS API
        // ==========================================

        // GET ALL DOCTORS (With Pagination, Search, & Filters)
        app.get('/doctors', async (req, res) => {
            try {
                const search = req.query.search || "";
                const specialization = req.query.specialization || "";
                const sort = req.query.sort || "";
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 9;
                const skip = (page - 1) * limit;
                let query = { verificationStatus: { $regex: /^verified$/i } };
                if (search) {
                    query.doctorName = { $regex: search, $options: 'i' };
                }
                if (specialization) {
                    query.specialization = specialization;
                }

                let sortObj = {};
                if (sort === "fee_asc") sortObj.consultationFee = 1;
                else if (sort === "fee_desc") sortObj.consultationFee = -1;
                else if (sort === "exp_desc") sortObj.experience = -1;
                else if (sort === "rating_desc") sortObj.averageRating = -1;
                else sortObj._id = -1;
                const totalDoctors = await doctorsCollection.countDocuments(query);
                const doctors = await doctorsCollection.find(query)
                    .sort(sortObj)
                    .skip(skip)
                    .limit(limit)
                    .toArray();
                res.send({
                    doctors,
                    totalPages: Math.ceil(totalDoctors / limit),
                    currentPage: page,
                    totalDoctors
                });
            } catch (error) {
                res.status(500).send({ message: "Server Error", error: error.message });
            }
        });

        // GET SINGLE DOCTOR DETAILS
        app.get('/doctors/:id', async (req, res) => {
            try {
                const id = req.params.id;
                if (!ObjectId.isValid(id)) {
                    return res.status(400).send({ message: "Invalid Doctor ID format" });
                }
                const query = { _id: new ObjectId(id) };
                const doctor = await doctorsCollection.findOne(query);
                if (!doctor) return res.status(404).send({ message: "Doctor not found" });
                res.send(doctor);
            } catch (error) {
                res.status(500).send({ message: "Server Error", error: error.message });
            }
        });

        // PUBLIC DYNAMIC STATS FOR HOME PAGE
        app.get('/public-stats', async (req, res) => {
            const totalDoctors = await doctorsCollection.countDocuments({ verificationStatus: 'verified' });
            const totalPatients = await usersCollection.countDocuments({ role: 'patient' });
            const totalAppointments = await appointmentsCollection.countDocuments();
            const totalReviews = await reviewsCollection.countDocuments();
            res.send({ totalDoctors, totalPatients, totalAppointments, totalReviews });
        });

        // ==========================================
        // 💳 STRIPE & APPOINTMENTS PAYMENT
        // ==========================================
        app.post('/create-checkout-session', verifyToken, async (req, res) => {
            try {
                const { doctor } = req.body;

                const session = await stripe.checkout.sessions.create({
                    payment_method_types: ['card'],
                    mode: 'payment',
                    line_items: [
                        {
                            price_data: {
                                currency: 'usd',
                                product_data: {
                                    name: `Appointment with ${doctor.doctorName}`,
                                    description: doctor.specialization,
                                },
                                unit_amount: doctor.consultationFee * 100,
                            },
                            quantity: 1,
                        },
                    ],
                    success_url:
                        'http://localhost:3000/payment-success?session_id={CHECKOUT_SESSION_ID}',
                    cancel_url:
                        'http://localhost:3000/payment-cancel',
                });
                res.send({
                    id: session.id,
                    url: session.url,
                });
            } catch (error) {
                console.log(error);
                res.status(500).send({
                    message: error.message,
                });
            }
        });

        app.post('/create-payment-intent', verifyToken, async (req, res) => {
            try {
                const { price } = req.body;
                if (!price) return res.status(400).send({ message: "Price is required" });
                const amount = Math.round(parseFloat(price) * 100);

                const paymentIntent = await stripe.paymentIntents.create({
                    amount: amount,
                    currency: 'usd',
                    payment_method_types: ['card']
                });
                res.send({ clientSecret: paymentIntent.client_secret });
            } catch (error) {
                res.status(500).send({ message: "Stripe Error", error: error.message });
            }
        });

        // Save Appointment & Transaction history
        app.post('/appointments', verifyToken, async (req, res) => {
            try {
                const payload = req.body;
                const currentDate = new Date();

                const appResult = await appointmentsCollection.insertOne({
                    patientId: payload.patientId,
                    patientEmail: payload.patientEmail,   // ✅ এটা save না হলে query কাজ করবে না
                    doctorId: new ObjectId(payload.doctorId),
                    doctorEmail: payload.doctorEmail,     // ✅ doctor dashboard এর জন্য
                    doctorName: payload.doctorName,       // ✅ payment history তে দেখানোর জন্য
                    specialty: payload.specialty,         // ✅ payment history তে দেখানোর জন্য
                    appointmentDate: payload.appointmentDate,
                    appointmentTime: payload.appointmentTime,
                    appointmentStatus: payload.appointmentStatus || 'pending',
                    symptoms: payload.symptoms,
                    createdAt: currentDate
                });

                await paymentsCollection.insertOne({
                    appointmentId: appResult.insertedId,
                    patientId: payload.patientId,
                    patientEmail: payload.patientEmail,   // ✅ এটাই দিয়ে query হবে
                    doctorName: payload.doctorName,       // ✅ payment card এ দেখাবে
                    specialty: payload.specialty,         // ✅ payment card এ দেখাবে
                    paymentStatus: payload.paymentStatus || 'paid',
                    amount: payload.amount,
                    transactionId: payload.transactionId,
                    date: currentDate
                });

                res.send({ success: true, insertedId: appResult.insertedId });
            } catch (error) {
                console.error("Backend Error:", error);
                res.status(500).send({ message: "Database Error", error: error.message });
            }
        });
        // সব অ্যাপয়েন্টমেন্ট দেখার জন্য
        app.get('/appointments', async (req, res) => {
            const result = await appointmentsCollection.find().toArray();
            res.send(result);
        });

        // সব পেমেন্ট দেখার জন্য
        app.get('/payments', async (req, res) => {
            const result = await paymentsCollection.find().toArray();
            res.send(result);
        });

        // ==========================================
        // 👤 PATIENT DASHBOARD CRUD
        // ==========================================

        // View Patient Appointments
        app.get('/patient/appointments/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const result = await appointmentsCollection
                    .find({ patientEmail: email })
                    .sort({ createdAt: -1 })
                    .toArray();
                res.send(result);
            } catch (error) {
                console.error('appointments error:', error);
                res.status(500).send({ message: error.message });
            }
        });

        // ২. Reschedule
        app.patch('/appointments/reschedule/:id', async (req, res) => {
            try {
                const filter = { _id: new ObjectId(req.params.id) };
                const { appointmentDate, appointmentTime } = req.body;
                const updatedDoc = {
                    $set: { appointmentDate, appointmentTime, appointmentStatus: 'pending' }
                };
                const result = await appointmentsCollection.updateOne(filter, updatedDoc);
                res.send(result);
            } catch (error) {
                console.error('reschedule error:', error);
                res.status(500).send({ message: error.message });
            }
        });

        // ৩. Cancel
        app.patch('/appointments/cancel/:id', async (req, res) => {
            try {
                const filter = { _id: new ObjectId(req.params.id) };
                const updatedDoc = { $set: { appointmentStatus: 'cancelled' } };
                const result = await appointmentsCollection.updateOne(filter, updatedDoc);
                res.send(result);
            } catch (error) {
                console.error('cancel error:', error);
                res.status(500).send({ message: error.message });
            }
        });

        // ৪. Payment History
        app.get('/patient/payments/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const result = await paymentsCollection
                    .find({ patientEmail: email })
                    .sort({ paymentDate: -1 })
                    .toArray();
                res.send(result);
            } catch (error) {
                console.error('payments error:', error);
                res.status(500).send({ message: error.message });
            }
        });

        // ৫. Dashboard Stats ✅ (fixed - no verifyToken, no email check)
        app.get('/patient/dashboard-stats/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const today = new Date().toISOString().split('T')[0]; // "2026-06-27"

                // এই patient এর সব appointments
                const allAppointments = await appointmentsCollection
                    .find({ patientEmail: email })
                    .toArray();

                // Upcoming — আজকের পরের এবং cancelled না
                const upcoming = allAppointments.filter(a =>
                    a.appointmentDate >= today &&
                    a.appointmentStatus !== 'cancelled'
                );

                // History — completed বা আজকের আগের
                const history = allAppointments.filter(a =>
                    a.appointmentDate < today ||
                    a.appointmentStatus === 'completed'
                );

                // Total Payments
                const payments = await paymentsCollection
                    .find({ patientEmail: email })
                    .toArray();

                const totalPayments = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

                // Next appointment
                const sortedUpcoming = upcoming.sort((a, b) =>
                    new Date(a.appointmentDate) - new Date(b.appointmentDate)
                );
                const nextAppt = sortedUpcoming[0];
                const nextAppointmentText = nextAppt
                    ? `Next: ${nextAppt.appointmentDate} at ${nextAppt.appointmentTime}`
                    : 'No upcoming appointments';

                // Last visit
                const sortedHistory = history.sort((a, b) =>
                    new Date(b.appointmentDate) - new Date(a.appointmentDate)
                );
                const lastVisit = sortedHistory[0];
                const lastVisitText = lastVisit
                    ? `Last visit: ${lastVisit.appointmentDate}`
                    : 'No previous records';

                res.send({
                    upcomingCount: upcoming.length,
                    totalHistoryCount: history.length,
                    totalPayments,
                    nextAppointmentText,
                    lastVisitText
                });

            } catch (error) {
                console.error('dashboard-stats error:', error);
                res.status(500).send({ message: error.message });
            }
        });

        // ৬. Favorite Doctors ✅ (fixed - empty array fallback)
        app.get('/patient/favorite-doctors/:email', async (req, res) => {
            try {
                const email = req.params.email;

                // user collection থেকে favoriteDoctors array বের করা
                const user = await usersCollection.findOne({ email: email });

                // favoriteDoctors না থাকলে empty array return
                const favoriteIds = user?.favoriteDoctors || [];

                if (favoriteIds.length === 0) {
                    return res.send([]);
                }

                // Valid ObjectId গুলো filter করা (invalid ID তে crash এড়াতে)
                const objectIds = favoriteIds
                    .filter(id => ObjectId.isValid(id))
                    .map(id => new ObjectId(id));

                if (objectIds.length === 0) {
                    return res.send([]);
                }

                const doctors = await doctorsCollection
                    .find({ _id: { $in: objectIds } })
                    .toArray();

                res.send(doctors);
            } catch (error) {
                console.error('favorite-doctors error:', error);
                res.status(500).send({ message: error.message });
            }
        });

        // ৬. ✅ Favorite Doctors (নতুন — এটাও আগে ছিল না)
        app.get('/patient/favorite-doctors/:email', verifyToken, async (req, res) => {
            try {
                const email = req.params.email;

                if (req.decoded.email !== email) {
                    return res.status(403).send({ message: 'Forbidden access' });
                }

                // User collection থেকে favoriteDoctors array বের করা
                const user = await usersCollection.findOne({ email });
                const favoriteIds = user?.favoriteDoctors || [];

                if (favoriteIds.length === 0) {
                    return res.send([]);
                }

                // Favorite doctor IDs দিয়ে doctors fetch করা
                const objectIds = favoriteIds.map(id => new ObjectId(id));
                const doctors = await doctorsCollection
                    .find({ _id: { $in: objectIds } })
                    .toArray();

                res.send(doctors);
            } catch (error) {
                res.status(500).send({ message: error.message });
            }
        });
        // Payment History
        app.get('/patient/payments/:email', async (req, res) => {
            try {
                const email = req.params.email;
                const result = await paymentsCollection
                    .find({ patientEmail: email })
                    .sort({ date: -1 })
                    .toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: error.message });
            }
        });
        // Reviews CRUD
        // রিভিউ পোস্ট করার জন্য
        app.post('/reviews', async (req, res) => {
            const review = req.body;
            const result = await reviewsCollection.insertOne(review);
            res.send(result);
        });

        // ইউজারের নিজের রিভিউ দেখার জন্য
        app.get('/reviews/my-reviews', async (req, res) => {
            // এখানে আপনার অথেন্টিকেশন মিডলওয়্যার ব্যবহার করবেন
            const email = req.query.email;
            const query = { email: email };
            const result = await reviewsCollection.find(query).toArray();
            res.send(result);
        });

        // রিভিউ ডিলিট করার জন্য
        app.delete('/reviews/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await reviewsCollection.deleteOne(query);
            res.send(result);
        });
        app.put('/reviews/:id', async (req, res) => {
            const id = req.params.id;
            const updatedReview = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: {
                    doctorName: updatedReview.doctorName,
                    specialty: updatedReview.specialty,
                    rating: updatedReview.rating,
                    comment: updatedReview.comment
                },
            };
            const result = await reviewsCollection.updateOne(filter, updateDoc);
            res.send(result);
        });
        // উদাহরণ: আপনার ব্যাকএন্ডের পেমেন্ট এন্ডপয়েন্টটি এমন হওয়া উচিত
        app.get('/payments', async (req, res) => {
            try {
                //verifyToken মিডলওয়্যার থেকে রিকোয়েস্ট করা ইউজারের ইমেইল নেওয়া
                const email = req.decoded?.email;

                if (!email) {
                    return res.status(401).send({ message: 'Unauthorized access' });
                }

                // শুধুমাত্র এই ইমেইলের পেমেন্টগুলো ডাটাবেজ থেকে খোঁজা
                const query = { email: email };
                const result = await paymentCollection.find(query).toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ message: error.message });
            }
        });
        app.get('/patient/appointments/:email', async (req, res) => {
            try {
                const email = req.params.email;

                // টোকেনের ইমেইল এবং প্যারামসের ইমেইল ভ্যালিডেশন (নিরাপত্তার জন্য)
                // if (req.decoded?.email !== email) {
                //     return res.status(403).send({ message: 'Forbidden access' });
                // }

                const query = { patientEmail: email }; // আপনার DB-তে ফিল্ডের নাম 'email' বা 'patientEmail' যা আছে তা দিন
                const result = await appointmentCollection.find(query).toArray();

                res.send(result);
            } catch (error) {
                console.error("Error fetching patient appointments:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        // ─── ২. অ্যাপয়েন্টমেন্ট রিশেডিউল করা (PATCH) ───
        app.patch('/appointments/reschedule/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const { appointmentDate, appointmentTime } = req.body;

                const filter = { _id: new ObjectId(id) };
                const updatedDoc = {
                    $set: {
                        appointmentDate: appointmentDate,
                        appointmentTime: appointmentTime,
                        appointmentStatus: "pending" // রিশেডিউল করলে স্ট্যাটাস সাধারণত আবার পেন্ডিং বা আপডেট হয়ে যায়
                    }
                };

                const result = await appointmentCollection.updateOne(filter, updatedDoc);

                // আপনার ফ্রন্টঅ্যান্ড `response.data.modifiedCount > 0` চেক করছে, তাই পুরো result অবজেক্ট পাঠানো হলো
                res.send(result);
            } catch (error) {
                console.error("Error rescheduling appointment:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });

        // ─── ৩. অ্যাপয়েন্টমেন্ট ক্যান্সেল করা (PATCH) ───
        app.patch('/appointments/cancel/:id', async (req, res) => {
            try {
                const id = req.params.id;

                const filter = { _id: new ObjectId(id) };
                const updatedDoc = {
                    $set: {
                        appointmentStatus: "cancelled" // স্ট্যাটাস পরিবর্তন করে cancelled করা হলো
                    }
                };

                const result = await appointmentCollection.updateOne(filter, updatedDoc);
                res.send(result);
            } catch (error) {
                console.error("Error cancelling appointment:", error);
                res.status(500).send({ message: "Internal Server Error" });
            }
        });
        // ==========================================
        // 🩺 DOCTOR DASHBOARD CRUD
        // ==========================================
        // Appointment Requests for a specific doctor
        app.get('/doctor/appointments/:email', verifyToken, async (req, res) => {
            const query = { doctorEmail: req.params.email };
            const result = await appointmentsCollection.find(query).toArray();
            res.send(result);
        });
        // Update Appointment Status (Accept/Reject/Complete)
        app.patch('/doctor/appointments/:id', verifyToken, async (req, res) => {
            const filter = { _id: new ObjectId(req.params.id) };
            const { status } = req.body; // status: 'accepted', 'rejected', or 'completed'
            const result = await appointmentsCollection.updateOne(filter, { $set: { appointmentStatus: status } });
            res.send(result);
        });
        // Prescription CRUD
        app.post('/prescriptions', verifyToken, async (req, res) => {
            const prescription = req.body;
            prescription.createdAt = new Date();
            const result = await prescriptionsCollection.insertOne(prescription);
            res.send(result);
        });
        // Doctor Profile Management (Update Qualifications, Slots etc)
        app.put('/doctor/profile/:email', verifyToken, async (req, res) => {
            const filter = { email: req.params.email };
            const updateData = req.body;
            const options = { upswith: true };
            const updatedDoc = {
                $set: {
                    qualifications: updateData.qualifications,
                    experience: parseInt(updateData.experience),
                    consultationFee: parseFloat(updateData.consultationFee),
                    availableSlots: updateData.availableSlots,
                    availableDays: updateData.availableDays,
                }
            };
            const result = await doctorsCollection.updateOne(filter, updatedDoc, options);
            res.send(result);
        });
        // ==========================================
        // 👑 ADMIN DASHBOARD API
        // ==========================================
        // Manage Users (View, Delete, Suspend)
        // index.js বা সার্ভার ফাইলে
        app.get('/admin/dashboard-stats', async (req, res) => {
            // এখানে MongoDB এগ্রিগেশন ব্যবহার করে ডাটাগুলো আনুন
            const totalPatients = await usersCollection.countDocuments({ role: 'patient' });
            const totalDoctors = await doctorsCollection.countDocuments();
            const totalAppointments = await appointmentsCollection.countDocuments();

            // ডক্টর পারফরম্যান্সের জন্য এগ্রিগেশন
            const doctorPerformance = await reviewsCollection.aggregate([
                { $group: { _id: "$doctorId", avgRating: { $avg: "$rating" } } },
                { $sort: { avgRating: -1 } },
                { $limit: 3 },
                // এখানে ডাক্তারদের নাম ও স্পেশালটি যুক্ত করার জন্য $lookup ব্যবহার করতে পারেন
            ]).toArray();

            res.send({
                totalPatients,
                totalDoctors,
                totalAppointments,
                doctorPerformance // অবশ্যই এটি যেন অ্যারে হয়
            });
        });
        app.get('/users', async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });
        app.patch('/users/status/:id', verifyToken, async (req, res) => {
            const filter = { _id: new ObjectId(req.params.id) };
            const { status } = req.body; // status: 'suspended' or 'active'
            const result = await usersCollection.updateOne(filter, { $set: { status } });
            res.send(result);
        });
        app.delete('/users/:id', verifyToken, async (req, res) => {
            const result = await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
            res.send(result);
        });
        // Manage Doctors Verification
        app.get('/admin/doctors', verifyToken, async (req, res) => {
            const result = await doctorsCollection.find().toArray();
            res.send(result);
        });
        app.patch('/doctors/verify/:id', verifyToken, async (req, res) => {
            const filter = { _id: new ObjectId(req.params.id) };
            const { status } = req.body; // status: 'verified' or 'unverified/rejected'
            const result = await doctorsCollection.updateOne(filter, { $set: { verificationStatus: status } });
            res.send(result);
        });
        // View All Appointments & Payments for Admin Monitoring
        app.get('/admin/appointments', verifyToken, async (req, res) => {
            const result = await appointmentsCollection.find().toArray();
            res.send(result);
        });
        app.get('/admin/payments', verifyToken, async (req, res) => {
            const result = await paymentsCollection.find().toArray();
            res.send(result);
        });
        // 📈 ADMIN RECHARTS ANALYTICS ENDPOINT
        app.get('/admin-analytics', verifyToken, async (req, res) => {
            const totalDoctors = await doctorsCollection.countDocuments();
            const totalPatients = await usersCollection.countDocuments({ role: 'patient' });
            const totalAppointments = await appointmentsCollection.countDocuments();

            // Format data for Recharts Graph (Group by Specialization or Ratings)
            const doctorPerformance = await doctorsCollection.find({}, { projection: { doctorName: 1, averageRating: 1 } }).toArray();
            res.send({
                totalPatients,
                totalDoctors,
                totalAppointments,
                doctorPerformance // Array format expected directly by <BarChart data={...} />
            });
        });
        // GET: সকল ইউজার
        app.get('/users', verifyToken, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        // PATCH: স্ট্যাটাস আপডেট (Suspend/Active)
        app.patch('/users/status/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const { status } = req.body;
            const filter = { _id: new ObjectId(id) };
            const updateDoc = { $set: { status: status } };
            const result = await usersCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // DELETE: ইউজার ডিলিট
        app.delete('/users/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
            res.send(result);
        });
        // GET: সকল ডক্টর দেখুন (পাবলিক বা অ্যাডমিন)
        app.get('/doctors', async (req, res) => {
            const result = await doctorsCollection.find().toArray();
            res.send({ doctors: result });
        });

        // PATCH: ডক্টর ভেরিফিকেশন স্ট্যাটাস আপডেট (Admin Only)
        app.patch('/doctors/verify/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const { verified } = req.body; // true বা false আসবে
            const filter = { _id: new ObjectId(id) };
            const updateDoc = {
                $set: { verificationStatus: verified ? 'Verified' : 'Pending' }
            };
            const result = await doctorsCollection.updateOne(filter, updateDoc);
            res.send(result);
        });

        // DELETE: ডক্টর রিজেক্ট বা রিমুভ (Admin Only)
        app.delete('/doctors/reject/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await doctorsCollection.deleteOne(query);
            res.send(result);
        });

        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } catch (error) {
        console.error("MongoDB Connection Error: ", error);
    }
}
run().catch(console.dir);

app.get('/', (req, res) => {
    res.send('MediCare Connect Server is Running!');
});

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});