package com.canteen.ordering.service;

import com.canteen.ordering.dto.OrderItemRequest;
import com.canteen.ordering.dto.OrderRequest;
import com.canteen.ordering.dto.OrderResponse;
import com.canteen.ordering.dto.OrderStats;
import com.canteen.ordering.exception.ResourceNotFoundException;
import com.canteen.ordering.model.MenuItem;
import com.canteen.ordering.model.Order;
import com.canteen.ordering.model.OrderItem;
import com.canteen.ordering.model.OrderStatus;
import com.canteen.ordering.repository.MenuItemRepository;
import com.canteen.ordering.repository.OrderRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class OrderService {

    private static final Logger log = LoggerFactory.getLogger(OrderService.class);

    private final OrderRepository orderRepository;
    private final MenuItemRepository menuItemRepository;

    /**
     * Keeps queue numbers unique even if two students tap "Place order"
     * at the exact same moment. Initialised from the database on first use.
     */
    private final AtomicInteger queueCounter = new AtomicInteger(0);
    private boolean queueCounterInitialised = false;

    public OrderService(OrderRepository orderRepository, MenuItemRepository menuItemRepository) {
        this.orderRepository = orderRepository;
        this.menuItemRepository = menuItemRepository;
    }

    @Transactional(readOnly = true)
    public List<OrderResponse> getOrders(OrderStatus status) {
        List<Order> orders = status == null
                ? orderRepository.findAllByOrderByCreatedAtDesc()
                : orderRepository.findByStatusOrderByCreatedAtDesc(status);

        return orders.stream().map(OrderResponse::from).toList();
    }

    @Transactional(readOnly = true)
    public OrderResponse getOrder(Long id) {
        return OrderResponse.from(findOrder(id));
    }

    @Transactional
    public OrderResponse createOrder(OrderRequest request) {
        // Merge duplicate lines so one order never contains the same item twice.
        Map<Long, Integer> quantities = new LinkedHashMap<>();
        for (OrderItemRequest line : request.items()) {
            quantities.merge(line.menuItemId(), line.quantity(), Integer::sum);
        }

        Map<Long, MenuItem> menuById = menuItemRepository.findAllById(quantities.keySet()).stream()
                .collect(Collectors.toMap(MenuItem::getId, Function.identity()));

        Order order = new Order();
        for (Map.Entry<Long, Integer> entry : quantities.entrySet()) {
            MenuItem menuItem = menuById.get(entry.getKey());
            if (menuItem == null) {
                throw new ResourceNotFoundException("Menu item " + entry.getKey() + " was not found.");
            }
            if (!menuItem.isAvailable()) {
                throw new IllegalArgumentException(menuItem.getName() + " is not available right now.");
            }
            if (entry.getValue() > 20) {
                throw new IllegalArgumentException("Quantity for " + menuItem.getName() + " must be at most 20.");
            }
            order.addItem(new OrderItem(
                    menuItem.getId(),
                    menuItem.getName(),
                    menuItem.getPrice(),
                    entry.getValue()
            ));
        }

        order.recalculateTotal();
        order.setQueueNumber(nextQueueNumber());
        order.setCustomerName(normaliseCustomerName(request.customerName()));
        order.setNotes(normaliseNotes(request.notes()));

        Order saved = orderRepository.save(order);
        log.info("Order id={} created with queue number {}", saved.getId(), saved.getQueueNumber());
        return OrderResponse.from(saved);
    }

    @Transactional
    public OrderResponse updateStatus(Long id, OrderStatus status) {
        Order order = findOrder(id);
        if (order.getStatus() == status) {
            return OrderResponse.from(order);
        }
        order.setStatus(status);
        Order saved = orderRepository.save(order);
        log.info("Order id={} moved to {}", saved.getId(), status);
        return OrderResponse.from(saved);
    }

    @Transactional(readOnly = true)
    public OrderStats getStats() {
        return new OrderStats(
                orderRepository.count(),
                orderRepository.countByStatus(OrderStatus.PENDING),
                orderRepository.countByStatus(OrderStatus.PREPARING),
                orderRepository.countByStatus(OrderStatus.READY),
                orderRepository.countByStatus(OrderStatus.COMPLETED),
                orderRepository.countByStatus(OrderStatus.CANCELLED),
                Math.max(orderRepository.findMaxQueueNumber() + 1,
                        queueCounter.get() + 1)
        );
    }

    private synchronized int nextQueueNumber() {
        if (!queueCounterInitialised) {
            queueCounter.set(orderRepository.findMaxQueueNumber());
            queueCounterInitialised = true;
        }
        return queueCounter.incrementAndGet();
    }

    private Order findOrder(Long id) {
        return orderRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Order " + id + " was not found."));
    }

    private String normaliseCustomerName(String customerName) {
        if (customerName == null || customerName.isBlank()) {
            return "Guest";
        }
        return customerName.trim();
    }

    private String normaliseNotes(String notes) {
        if (notes == null || notes.isBlank()) {
            return null;
        }
        return notes.trim();
    }
}
