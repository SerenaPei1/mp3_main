module.exports = function (router) {
    var mongoose = require('mongoose');
    var Task = require('../models/task');
    var User = require('../models/user');

    var tasksRoute = router.route('/tasks');

    tasksRoute.get(function (req, res) {
        var where = {};
        var sort = {};
        var select = {};
        var skip = 0;
        var limit = 100;

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
            return Task.countDocuments(where).exec(function (err, count) {
                if (err) return res.status(500).json({ message: "Internal Server Error", data: "Failed to count tasks" });
                return res.status(200).json({ count });
            });
        }

        var query = Task.find(where).select(select).sort(sort).skip(skip).limit(limit);
        query.exec(function (err, tasks) {
            if (err) return res.status(500).json({ message: "Internal Server Error", data: "Failed to fetch tasks" });
            return res.status(200).json({ message: "OK", data: tasks });
        });
    });

    tasksRoute.post(function (req, res) {
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({ message: "Bad Request", data: "Name and deadline are required" });
        }

        var newTask = new Task({
            name: req.body.name,
            description: req.body.description || "",
            deadline: req.body.deadline,
            completed: req.body.completed || false,
            assignedUser: req.body.assignedUser || "",
            assignedUserName: req.body.assignedUserName || "unassigned",
            dateCreated: req.body.dateCreated || Date.now()
        });

        newTask.save(function (err, task) {
            if (err) return res.status(500).json({ message: "Internal Server Error", data: "Failed to create task" });

            if (task.assignedUser && task.assignedUser !== "" && !task.completed) {
                User.findById(task.assignedUser).exec(function (err, user) {
                    if (user) {
                        var pendingTasks = user.pendingTasks || [];
                        if (pendingTasks.indexOf(task._id.toString()) === -1) {
                            pendingTasks.push(task._id.toString());
                            User.findByIdAndUpdate(task.assignedUser, { pendingTasks }).exec();
                        }
                    }
                });
            }

            return res.status(201).json({ message: "Created", data: task });
        });
    });

    var taskRoute = router.route('/tasks/:id');

    taskRoute.get(function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: "Task Not Found", data: "Invalid task ID" });
        }

        var select = {};
        if (req.query.select) {
            try { select = JSON.parse(req.query.select); }
            catch (e) { return res.status(400).json({ message: "Invalid select parameter", data: "JSON parsing error" }); }
        }

        var query = Task.findById(req.params.id).select(select);
        query.exec(function (err, task) {
            if (err || !task) return res.status(404).json({ message: "Task Not Found", data: "Task not found" });
            return res.status(200).json({ message: "OK", data: task });
        });
    });

    taskRoute.put(function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: "Task Not Found", data: "Invalid task ID" });
        }

        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({ message: "Bad Request", data: "Name and deadline are required" });
        }

        Task.findById(req.params.id).exec(function (err, existingTask) {
            if (err || !existingTask) return res.status(404).json({ message: "Task Not Found", data: "Task not found" });

            var oldAssignedUser = existingTask.assignedUser;
            var newAssignedUser = req.body.assignedUser || "";

            Task.findByIdAndUpdate(req.params.id, {
                name: req.body.name,
                description: req.body.description || "",
                deadline: req.body.deadline,
                completed: req.body.completed || false,
                assignedUser: newAssignedUser,
                assignedUserName: req.body.assignedUserName || "unassigned",
                dateCreated: req.body.dateCreated || existingTask.dateCreated
            }, { new: true, runValidators: true }, function (err, task) {
                if (err) return res.status(500).json({ message: "Internal Server Error", data: "Failed to update task" });

                if (oldAssignedUser && oldAssignedUser !== "" && oldAssignedUser !== newAssignedUser) {
                    User.findById(oldAssignedUser).exec(function (err, user) {
                        if (user) {
                            var pendingTasks = user.pendingTasks.filter(function(taskId) {
                                return taskId !== req.params.id;
                            });
                            User.findByIdAndUpdate(oldAssignedUser, { pendingTasks }).exec();
                        }
                    });
                }

                if (newAssignedUser && newAssignedUser !== "" && !task.completed) {
                    User.findById(newAssignedUser).exec(function (err, user) {
                        if (user) {
                            var pendingTasks = user.pendingTasks || [];
                            if (pendingTasks.indexOf(req.params.id) === -1) {
                                pendingTasks.push(req.params.id);
                                User.findByIdAndUpdate(newAssignedUser, { pendingTasks }).exec();
                            }
                        }
                    });
                } else if (task.completed && newAssignedUser && newAssignedUser !== "") {
                    User.findById(newAssignedUser).exec(function (err, user) {
                        if (user) {
                            var pendingTasks = user.pendingTasks.filter(function(taskId) {
                                return taskId !== req.params.id;
                            });
                            User.findByIdAndUpdate(newAssignedUser, { pendingTasks }).exec();
                        }
                    });
                }

                return res.status(200).json({ message: "OK", data: task });
            });
        });
    });

    taskRoute.delete(function (req, res) {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            return res.status(404).json({ message: "Task Not Found", data: "Invalid task ID" });
        }

        Task.findByIdAndDelete(req.params.id, function (err, task) {
            if (err || !task) return res.status(404).json({ message: "Task Not Found", data: "Task not found" });

            if (task.assignedUser && task.assignedUser !== "") {
                User.findById(task.assignedUser).exec(function (err, user) {
                    if (user) {
                        var pendingTasks = user.pendingTasks.filter(function(taskId) {
                            return taskId !== req.params.id;
                        });
                        User.findByIdAndUpdate(task.assignedUser, { pendingTasks }).exec();
                    }
                });
            }

            return res.status(204).send();
        });
    });

    return router;
};
