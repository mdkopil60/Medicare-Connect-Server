const dns = require('node:dns');
dns.setServers(["8.8.8.8", "8.8.4.4"]);

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
    origin: [
        'http://localhost:3000',
        'https://medicare-connect-client-psi.vercel.app'
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
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

const verifyToken = (req, res, next) => next();

// async function run() {
//     try {
//         await client.connect();
client.connect(() => {
    console.log('connecting to mongodb')
}).catch(console.dir)
const database = client.db("medicare-connect");
const usersCollection = database.collection("user");
const doctorsCollection = database.collection("doctors");
const appointmentsCollection = database.collection("appointments");
const reviewsCollection = database.collection("reviews");
const paymentsCollection = database.collection("payments");
const prescriptionsCollection = database.collection("prescriptions");

//  AUTH & USERS
app.post('/jwt', async (req, res) => {
    const user = req.body;
    const token = jwt.sign(user, process.env.JWT_SECRET, { expiresIn: '12h' });
    res.send({ token });
});

app.post('/users', async (req, res) => {
    const user = req.body;
    const existing = await usersCollection.findOne({ email: user.email });
    if (existing) return res.send({ message: 'User already exists', insertedId: null });
    const result = await usersCollection.insertOne({
        ...user,
        createdAt: new Date(),
        status: 'active'
    });
    res.send(result);
});

app.get('/users/role/:email', async (req, res) => {
    const user = await usersCollection.findOne({ email: req.params.email });
    res.send({ role: user?.role || 'patient' });
});

//  ADMIN ROUTES

app.get('/users', async (req, res) => {
    try {
        const result = await usersCollection.find().toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.patch('/users/status/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const result = await usersCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { status } }
        );
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.delete('/users/:id', async (req, res) => {
    try {
        const result = await usersCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.get('/admin/doctors', async (req, res) => {
    const result = await doctorsCollection.find().toArray();
    res.send(result);
});

app.patch('/doctors/verify/:id', async (req, res) => {
    try {
        const result = await doctorsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { verificationStatus: 'Verified' } }
        );
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.delete('/doctors/reject/:id', async (req, res) => {
    try {
        const result = await doctorsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.get('/admin/appointments', async (req, res) => {
    const result = await appointmentsCollection.find().toArray();
    res.send(result);
});

app.get('/admin/payments', async (req, res) => {
    const result = await paymentsCollection.find().toArray();
    res.send(result);
});

//  Admin dashboard stats — 
app.get('/admin/dashboard-stats', async (req, res) => {
    try {
        const totalUsers = await usersCollection.countDocuments({});
        const totalDoctors = await doctorsCollection.countDocuments({});
        const totalAppointments = await appointmentsCollection.countDocuments({});
        const totalPayments = await paymentsCollection.countDocuments({});
        const pendingDoctors = await doctorsCollection.countDocuments({ verificationStatus: 'Pending' });
        const payments = await paymentsCollection.find({}).toArray();
        const topDoctors = await doctorsCollection.find({ verificationStatus: 'Verified' }).limit(3).toArray();
        const totalRevenue = payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

        res.send({
            totalPatients: totalUsers,
            totalDoctors,
            totalAppointments,
            totalPayments,
            totalRevenue,
            pendingDoctors,
            doctorPerformance: topDoctors.map(doc => ({
                name: doc.doctorName,
                specialty: doc.specialization,
                rating: doc.rating || '4.5'
            }))
        });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.get('/admin-analytics', async (req, res) => {
    try {
        const totalDoctors = await doctorsCollection.countDocuments({});
        const totalPatients = await usersCollection.countDocuments({});
        const totalAppointments = await appointmentsCollection.countDocuments({});
        res.send({ totalPatients, totalDoctors, totalAppointments });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

//  PUBLIC DOCTORS API

app.get('/doctors', async (req, res) => {
    try {
        const search = req.query.search || "";
        const specialization = req.query.specialization || "";
        const sort = req.query.sort || "";
        const status = req.query.status || "";
        const admin = req.query.admin || ""; // ✅ admin query
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 9;
        const skip = (page - 1) * limit;

        let query = {};

        if (admin === 'true') {
            if (status) {
                query.verificationStatus = { $regex: new RegExp(`^${status}$`, 'i') };
            }
        } else if (status) {
            query.verificationStatus = { $regex: new RegExp(`^${status}$`, 'i') };
        } else {
            query.verificationStatus = { $regex: /^verified$/i };
        }
        if (search) query.doctorName = { $regex: search, $options: 'i' };
        if (specialization) query.specialization = specialization;
        let sortObj = {};
        if (sort === "fee_asc") sortObj.consultationFee = 1;
        else if (sort === "fee_desc") sortObj.consultationFee = -1;
        else if (sort === "exp_desc") sortObj.experience = -1;
        else if (sort === "rating_desc") sortObj.averageRating = -1;
        else sortObj._id = -1;
        const totalDoctors = await doctorsCollection.countDocuments(query);
        const doctors = await doctorsCollection.find(query).sort(sortObj).skip(skip).limit(limit).toArray();
        res.send({
            doctors,
            totalPages: Math.ceil(totalDoctors / limit),
            currentPage: page,
            totalDoctors
        });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.get('/doctors/:id', async (req, res) => {
    try {
        if (!ObjectId.isValid(req.params.id)) return res.status(400).send({ message: "Invalid ID" });
        const doctor = await doctorsCollection.findOne({ _id: new ObjectId(req.params.id) });
        if (!doctor) return res.status(404).send({ message: "Doctor not found" });
        res.send(doctor);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.get('/public-stats', async (req, res) => {
    const totalDoctors = await doctorsCollection.countDocuments({ verificationStatus: 'verified' });
    const uniquePatients = await appointmentsCollection.distinct('patientEmail');
    const totalAppointments = await appointmentsCollection.countDocuments();
    const totalReviews = await reviewsCollection.countDocuments();
    res.send({ totalDoctors, totalPatients: uniquePatients.length, totalAppointments, totalReviews });
});

//  STRIPE & APPOINTMENTS

app.post('/create-checkout-session', async (req, res) => {
    try {
        const { doctor } = req.body;
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            mode: 'payment',
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: `Appointment with ${doctor.doctorName}`, description: doctor.specialization },
                    unit_amount: doctor.consultationFee * 100,
                },
                quantity: 1,
            }],
            success_url: 'http://localhost:3000/payment-success?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: 'http://localhost:3000/payment-cancel',
        });
        res.send({ id: session.id, url: session.url });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.post('/create-payment-intent', async (req, res) => {
    try {
        const { price } = req.body;
        if (!price) return res.status(400).send({ message: "Price is required" });
        const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(parseFloat(price) * 100),
            currency: 'usd',
            payment_method_types: ['card']
        });
        res.send({ clientSecret: paymentIntent.client_secret });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.post('/appointments', async (req, res) => {
    try {
        const payload = req.body;
        const currentDate = new Date();
        const appResult = await appointmentsCollection.insertOne({
            patientId: payload.patientId,
            patientEmail: payload.patientEmail,
            patientName: payload.patientName || '',
            doctorId: new ObjectId(payload.doctorId),
            doctorEmail: payload.doctorEmail || "",
            doctorName: payload.doctorName,
            specialty: payload.specialty,
            appointmentDate: payload.appointmentDate,
            appointmentTime: payload.appointmentTime,
            appointmentStatus: payload.appointmentStatus || 'pending',
            symptoms: payload.symptoms,
            createdAt: currentDate
        });
        await paymentsCollection.insertOne({
            appointmentId: appResult.insertedId,
            patientId: payload.patientId,
            patientEmail: payload.patientEmail,
            doctorName: payload.doctorName,
            specialty: payload.specialty,
            paymentStatus: payload.paymentStatus || 'paid',
            amount: payload.amount,
            transactionId: payload.transactionId,
            paymentDate: currentDate
        });
        res.send({ success: true, insertedId: appResult.insertedId });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// appointments/status 
app.patch('/appointments/status/:id', async (req, res) => {
    try {
        const { status } = req.body;
        const result = await appointmentsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { appointmentStatus: status } }
        );
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.get('/appointments', verifyToken, async (req, res) => {
    try {
        const appointments = await appointmentsCollection
            .find({})
            .sort({ appointmentDate: -1 })
            .toArray();
        res.send(appointments);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.delete('/appointments/:id', verifyToken, async (req, res) => {
    try {
        const result = await appointmentsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
// 👤 PATIENT DASHBOARD
app.get('/patient/appointments/:email', async (req, res) => {
    try {
        const result = await appointmentsCollection
            .find({ patientEmail: req.params.email })
            .sort({ createdAt: -1 })
            .toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
app.patch('/appointments/reschedule/:id', async (req, res) => {
    try {
        const { appointmentDate, appointmentTime } = req.body;
        const result = await appointmentsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { appointmentDate, appointmentTime, appointmentStatus: 'pending' } }
        );
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
app.patch('/appointments/cancel/:id', async (req, res) => {
    try {
        const result = await appointmentsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { appointmentStatus: 'cancelled' } }
        );
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
app.get('/patient/payments/:email', async (req, res) => {
    try {
        const result = await paymentsCollection
            .find({ patientEmail: req.params.email })
            .sort({ paymentDate: -1 })
            .toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
app.get('/patient/dashboard-stats/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const today = new Date().toISOString().split('T')[0];
        const allAppointments = await appointmentsCollection.find({ patientEmail: email }).toArray();
        const upcoming = allAppointments.filter(a => a.appointmentDate >= today && a.appointmentStatus !== 'cancelled');
        const history = allAppointments.filter(a => a.appointmentDate < today || a.appointmentStatus === 'completed');
        const payments = await paymentsCollection.find({ patientEmail: email }).toArray();
        const totalPayments = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
        const nextAppt = upcoming.sort((a, b) => new Date(a.appointmentDate) - new Date(b.appointmentDate))[0];
        const lastVisit = history.sort((a, b) => new Date(b.appointmentDate) - new Date(a.appointmentDate))[0];
        res.send({
            upcomingCount: upcoming.length,
            totalHistoryCount: history.length,
            totalPayments,
            nextAppointmentText: nextAppt ? `Next: ${nextAppt.appointmentDate} at ${nextAppt.appointmentTime}` : 'No upcoming appointments',
            lastVisitText: lastVisit ? `Last visit: ${lastVisit.appointmentDate}` : 'No previous records'
        });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.get('/patient/favorite-doctors/:email', async (req, res) => {
    try {
        const user = await usersCollection.findOne({ email: req.params.email });
        const favoriteIds = (user?.favoriteDoctors || []).filter(id => ObjectId.isValid(id)).map(id => new ObjectId(id));
        if (favoriteIds.length === 0) return res.send([]);
        const doctors = await doctorsCollection.find({ _id: { $in: favoriteIds } }).toArray();
        res.send(doctors);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// 🩺 DOCTOR DASHBOARD
app.get('/doctor/appointments/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: 'User not found' });
        let doctor = await doctorsCollection.findOne({ userId: user._id.toString() });

        if (!doctor) {
            doctor = await doctorsCollection.findOne({
                doctorName: { $regex: user.name?.trim(), $options: 'i' }
            });
        }
        const query = doctor
            ? {
                $or: [
                    { doctorId: doctor._id.toString() },
                    { doctorId: doctor._id },
                    { doctorEmail: email },
                    { doctorName: doctor.doctorName }
                ]
            }
            : {
                $or: [
                    { doctorEmail: email },
                    { doctorName: user.name }
                ]
            };

        const appointments = await appointmentsCollection
            .find(query)
            .sort({ appointmentDate: -1 })
            .toArray();
        res.send(appointments);
    } catch (error) {
        console.error("Error:", error);
        res.status(500).send({ message: error.message });
    }
});
//  Doctor profile GET
app.get('/doctor/profile/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: 'User not found' });
        let doctor = await doctorsCollection.findOne({ userId: user._id.toString() });
        if (!doctor) doctor = await doctorsCollection.findOne({ email });
        if (!doctor) doctor = await doctorsCollection.findOne({
            doctorName: { $regex: user.name, $options: 'i' }
        });
        if (!doctor) return res.status(404).send({ message: 'Doctor not found' });
        res.send(doctor);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
app.put('/doctor/profile/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: 'User not found' });
        let doctor = await doctorsCollection.findOne({ userId: user._id.toString() });
        if (!doctor) doctor = await doctorsCollection.findOne({ email });
        if (!doctor) doctor = await doctorsCollection.findOne({
            doctorName: { $regex: user.name?.trim(), $options: 'i' }
        });
        if (!doctor) {
            const newDoctor = {
                ...req.body,
                email,
                userId: user._id.toString(),
                verificationStatus: 'Pending',
                createdAt: new Date()
            };
            const result = await doctorsCollection.insertOne(newDoctor);
            return res.send({ ...result, created: true });
        }
        const result = await doctorsCollection.updateOne(
            { _id: doctor._id },
            {
                $set: {
                    ...req.body,
                    email,
                    userId: user._id.toString(),
                }
            }
        );
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
app.get('/doctor/dashboard-stats', async (req, res) => {
    try {
        const email = req.query.email;
        if (!email) return res.status(400).send({ message: 'Email required' });
        const doctor = await doctorsCollection.findOne({ email });
        if (!doctor) return res.status(404).send({ message: 'Doctor not found' });

        const today = new Date().toISOString().split('T')[0];

        const allAppointments = await appointmentsCollection.find({
            $or: [
                { doctorId: doctor._id },
                { doctorId: doctor._id.toString() },
                { doctorEmail: email }
            ]
        }).toArray();

        const uniquePatients = new Set(
            allAppointments.map(a => a.patientEmail).filter(Boolean)
        ).size;

        const todaysAppointments = allAppointments.filter(
            a => a.appointmentDate === today
        ).length;

        const reviews = await reviewsCollection.find({
            $or: [
                { doctorId: doctor._id.toString() },
                { doctorEmail: email }
            ]
        }).toArray();

        const totalReviews = reviews.length;
        const averageRating = totalReviews > 0
            ? (reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / totalReviews).toFixed(1)
            : "0.0";
        res.send({ totalPatients: uniquePatients, todaysAppointments, totalReviews, averageRating });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// Doctor schedule routes
app.get('/doctor/schedule/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: 'User not found' });
        let doctor = await doctorsCollection.findOne({ userId: user._id.toString() });
        if (!doctor) doctor = await doctorsCollection.findOne({ email });
        if (!doctor) doctor = await doctorsCollection.findOne({
            doctorName: { $regex: user.name, $options: 'i' }
        });
        if (!doctor) return res.status(404).send({ message: 'Doctor profile not found' });
        if (!doctor.userId) {
            await doctorsCollection.updateOne(
                { _id: doctor._id },
                { $set: { userId: user._id.toString() } }
            );
        }
        res.send({
            doctorId: doctor._id,
            availableDays: doctor.availableDays || [],
            availableSlots: doctor.availableSlots || []
        });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.post('/doctor/schedule/slot/:email', async (req, res) => {
    try {
        const email = req.params.email;
        const { day, startTime, endTime, maxPatients } = req.body;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: 'User not found' });
        let doctor = await doctorsCollection.findOne({ userId: user._id.toString() });
        if (!doctor) doctor = await doctorsCollection.findOne({ email });
        if (!doctor) return res.status(404).send({ message: 'Doctor profile not found' });
        const newSlot = { _id: new ObjectId(), day, startTime, endTime, maxPatients: parseInt(maxPatients) };
        await doctorsCollection.updateOne(
            { _id: doctor._id },
            {
                $push: { availableSlots: newSlot },
                $addToSet: { availableDays: day },
                $set: { userId: user._id.toString() }
            }
        );
        res.send({ success: true, slot: newSlot });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// PATCH - update specific slot
app.patch('/doctor/schedule/slot/:email/:slotId', async (req, res) => {
    try {
        const { email, slotId } = req.params;
        const { day, startTime, endTime, maxPatients } = req.body;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: 'User not found' });

        let doctor = await doctorsCollection.findOne({ userId: user._id.toString() });
        if (!doctor) {
            doctor = await doctorsCollection.findOne({
                doctorName: { $regex: user.name?.trim(), $options: 'i' }
            });
        }
        if (!doctor) return res.status(404).send({ message: 'Doctor not found' });

        // slotId valid ObjectId check
        let slotFilter;
        try {
            slotFilter = { 'availableSlots._id': new ObjectId(slotId) };
        } catch {
            // ObjectId string match 
            slotFilter = { 'availableSlots._id': slotId };
        }
        const result = await doctorsCollection.updateOne(
            { _id: doctor._id, ...slotFilter },
            {
                $set: {
                    'availableSlots.$.day': day,
                    'availableSlots.$.startTime': startTime,
                    'availableSlots.$.endTime': endTime,
                    'availableSlots.$.maxPatients': parseInt(maxPatients)
                }
            }
        );
        const updated = await doctorsCollection.findOne({ _id: doctor._id });
        const allDays = [...new Set((updated.availableSlots || []).map(s => s.day).filter(Boolean))];
        await doctorsCollection.updateOne(
            { _id: doctor._id },
            { $set: { availableDays: allDays } }
        );

        res.send({ success: true, result });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// DELETE - remove specific slot
app.delete('/doctor/schedule/slot/:email/:slotId', async (req, res) => {
    try {
        const { email, slotId } = req.params;
        const user = await usersCollection.findOne({ email });
        if (!user) return res.status(404).send({ message: 'User not found' });

        let doctor = await doctorsCollection.findOne({ userId: user._id.toString() });
        if (!doctor) {
            doctor = await doctorsCollection.findOne({
                doctorName: { $regex: user.name?.trim(), $options: 'i' }
            });
        }
        if (!doctor) return res.status(404).send({ message: 'Doctor not found' });
        let pullFilter;
        try {
            pullFilter = { _id: new ObjectId(slotId) };
        } catch {
            pullFilter = { _id: slotId };
        }

        await doctorsCollection.updateOne(
            { _id: doctor._id },
            { $pull: { availableSlots: pullFilter } }
        );

        const updated = await doctorsCollection.findOne({ _id: doctor._id });
        const allDays = [...new Set((updated.availableSlots || []).map(s => s.day).filter(Boolean))];
        await doctorsCollection.updateOne(
            { _id: doctor._id },
            { $set: { availableDays: allDays } }
        );

        res.send({ success: true });
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
// 💊 PRESCRIPTIONS
app.post('/prescriptions', async (req, res) => {
    try {
        const prescription = { ...req.body, createdAt: new Date() };
        const result = await prescriptionsCollection.insertOne(prescription);
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.get('/prescriptions', async (req, res) => {
    try {
        const { doctorEmail, patientEmail, appointmentId } = req.query;
        let query = {};
        if (doctorEmail) query.doctorEmail = doctorEmail;
        if (patientEmail) query.patientEmail = patientEmail;
        if (appointmentId) query.appointmentId = appointmentId;
        const result = await prescriptionsCollection.find(query).sort({ createdAt: -1 }).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.patch('/prescriptions/:id', async (req, res) => {
    try {
        const result = await prescriptionsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { ...req.body, updatedAt: new Date() } }
        );
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

app.delete('/prescriptions/:id', async (req, res) => {
    try {
        const result = await prescriptionsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
// ⭐ REVIEWS
app.post('/reviews', async (req, res) => {
    try {
        const result = await reviewsCollection.insertOne({ ...req.body, createdAt: new Date() });
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
app.get('/reviews/my-reviews', async (req, res) => {
    try {
        const result = await reviewsCollection.find({ email: req.query.email }).toArray();
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
app.put('/reviews/:id', async (req, res) => {
    try {
        const { doctorName, specialty, rating, comment } = req.body;
        const result = await reviewsCollection.updateOne(
            { _id: new ObjectId(req.params.id) },
            { $set: { doctorName, specialty, rating, comment } }
        );
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
app.delete('/reviews/:id', async (req, res) => {
    try {
        const result = await reviewsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
        res.send(result);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});

// 💰 PAYMENTS
app.get('/payments', async (req, res) => {
    try {
        const payments = await paymentsCollection.find({}).sort({ _id: -1 }).toArray();

        // amount কে number-এ convert করো
        const normalized = payments.map(p => ({
            ...p,
            amount: Number(p.amount) || 0
        }));

        res.send(normalized);
    } catch (error) {
        res.status(500).send({ message: error.message });
    }
});
console.log("✅ Connected to MongoDB!");
//     } catch (error) {
//         console.error("MongoDB Connection Error:", error);
//     }
// }

// // run().catch(console.dir);
// app.get('/', (req, res) => {
//     res.send('MediCare Connect Server is Running!');
// });
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
module.exports = app;