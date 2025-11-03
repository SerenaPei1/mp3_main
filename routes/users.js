module.exports = function (router) {
    var mongoose = require('mongoose');
    var User = require('../models/user');
    var Task = require('../models/task');

    var usersRoute = router.route('/users');

    usersRoute.get(function (req, res) {
        var where = {};
        var sort = {};
        var select = {};
        var skip = 0;
        var limit = 0;

        if (req.query.where) {
            try { where = JSON.parse(req.query.where); }
            catch (e) { return res.status(400).json({ message: "Invalid where parameter", data: "JSON parsing error" }); }
        }

        if (req.query.sort) {
            try { sort = JSON.parse(req.query.sort); }
            catch (e) { return res.status(400).json({ message: "Invalid sort parameter", data: "JSON parsing error" }); }
        }

        if (req.query.select) {
            try { select = JSON.parse(req.query.select); }
            catch (e) { return res.status(400).json({ message: "Invalid select parameter", data: "JSON parsing error" }); }
        }

        if (req.query.skip) skip = parseInt(req.query.skip);
        if (req.query.limit) limit = parseInt(req.query.limit);

        // ✅ fixing count=true behaviour (return {count:N})
        if (req.query.count === 'true' || req.query.count === '1') {
            return User.countDocuments(where).exec(function (err, count) {
                if (err) return res.status(500).json({ message: "Internal Server Error", data: "Failed to count users" });
                return res.status(200).json({ count });
            });
        }

        var query = User.find(where).select(select).sort(sort).skip(skip);
        if (limit > 0) query = query.limit(limit);

        query.exec(function (err, users) {
            if (err) return res.status(500).json({ message: "Internal Server Error", data: "Failed to fetch users" });
            return res.status(200).json({ message: "OK", data: users });
        });
    });

    usersRoute.post(function (req, res) {
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({ message: "Bad Request", data: "Name and email are required" });
        }

        var newUser = new User({
            name: req.body.name,
            email: req.body.email,
            pendingTasks: req.body.pendingTasks || [],
            dateCreated: req.body.dateCreated || Date.now()
        });

        newUser.save(function (err, user) {
            if (err) {
                if (err.code === 11000) {
                    return res.status(400).json({ message: "Bad Request", data: "Email already exists" });
                }
                return res.status(500).json({ message: "Internal Server Error", data: "Failed to create user" });
            }

            if (user.pendingTasks && user.pendingTasks.length > 0) {
                Task.find({ _id: { $in: user.pendingTasks }, assignedUser: { $ne: "" } }).exec(function (err, assignedTasks) {
                    if (err) {
                        User.findByIdAndDelete(user._id).exec();
                        return res.status(500).json({ message: "Internal Server Error", data: "Failed to validate task assignments" });
                    }

                    if (assignedTasks && assignedTasks.length > 0) {
                        User.findByIdAndDelete(user._id).exec();
                        return res.status(400).json({ message: "Bad Request", data: "Some tasks are already assigned to other users" });
                    }

                    Task.find({ _id: { $in: user.pendingTasks }, completed: false }).exec(function (err, pendingTasksList) {
                        var taskIdsToUpdate = pendingTasksList.map(function(task) { return task._id.toString(); });

                        Task.updateMany(
                            { _id: { $in: taskIdsToUpdate } },
                            { $set: { assignedUser: user._id.toString(), assignedUserName: user.name } }
                        ).exec(function (err) {
                            if (err) console.error("Error updating tasks:", err);

                            User.findByIdAndUpdate(user._id, { pendingTasks: taskIdsToUpdate }, { new: true }).exec(function (err, updatedUser) {
                                if (err) console.error("Error updating user's pendingTasks:", err);
                                return res.status(201).json({ message: "Created", data: updatedUser });
                            });
                        });
                    });
                });
            } else {
                return res.status(201).json({ message: "Created", data: user });
            }
        });
    });

    var userRoute = router.route('/users/:id');

    userRoute.get(function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: "User Not Found", data: "Invalid user ID" });
        }

        var select = {};
        if (req.query.select) {
            try { select = JSON.parse(req.query.select); }
            catch (e) { return res.status(400).json({ message: "Invalid select parameter", data: "JSON parsing error" }); }
        }

        var query = User.findById(req.params.id).select(select);
        query.exec(function (err, user) {
            if (err || !user) return res.status(404).json({ message: "User Not Found", data: "User not found" });
            return res.status(200).json({ message: "OK", data: user });
        });
    });

    userRoute.put(function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: "User Not Found", data: "Invalid user ID" });
        }

        if (!req.body.name || !req.body.email) {
            return res.status(400).json({ message: "Bad Request", data: "Name and email are required" });
        }

        User.findById(req.params.id).exec(function (err, existingUser) {
            if (err || !existingUser) return res.status(404).json({ message: "User Not Found", data: "User not found" });

            var updatedPendingTasks = req.body.pendingTasks || [];
            var userIdStr = req.params.id;

            Task.find({ _id: { $in: updatedPendingTasks }, assignedUser: { $nin: ["", userIdStr] } }).exec(function (err, assignedTasks) {
                if (err) return res.status(500).json({ message: "Internal Server Error", data: "Failed to validate task assignments" });

                if (assignedTasks && assignedTasks.length > 0) {
                    return res.status(400).json({ message: "Bad Request", data: "Some tasks are already assigned to other users" });
                }

                User.findByIdAndUpdate(req.params.id, {
                    name: req.body.name,
                    email: req.body.email,
                    pendingTasks: updatedPendingTasks,
                    dateCreated: req.body.dateCreated || existingUser.dateCreated
                }, { new: true, runValidators: true }, function (err, user) {
                    if (err) {
                        if (err.code === 11000) return res.status(400).json({ message: "Bad Request", data: "Email already exists" });
                        return res.status(500).json({ message: "Internal Server Error", data: "Failed to update user" });
                    }

                    Task.find({ _id: { $in: user.pendingTasks }, completed: false }).exec(function (err, pendingTasksList) {
                        var taskIdsToUpdate = pendingTasksList.map(function(task) { return task._id.toString(); });

                        Task.updateMany(
                            { _id: { $in: taskIdsToUpdate } },
                            { $set: { assignedUser: user._id.toString(), assignedUserName: user.name } }
                        ).exec();

                        Task.updateMany(
                            { _id: { $nin: taskIdsToUpdate }, assignedUser: user._id.toString() },
                            { $set: { assignedUser: "", assignedUserName: "unassigned" } }
                        ).exec();

                        User.findByIdAndUpdate(user._id, { pendingTasks: taskIdsToUpdate }, { new: true }).exec(function (err, updatedUser) {
                            return res.status(200).json({ message: "OK", data: updatedUser || user });
                        });
                    });
                });
            });
        });
    });

    userRoute.delete(function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: "User Not Found", data: "Invalid user ID" });
        }

        User.findByIdAndDelete(req.params.id, function (err, user) {
            if (err || !user) return res.status(404).json({ message: "User Not Found", data: "User not found" });

            Task.updateMany(
                { assignedUser: req.params.id },
                { $set: { assignedUser: "", assignedUserName: "unassigned" } }
            ).exec();

            return res.status(204).send();
        });
    });

    return router;
};
