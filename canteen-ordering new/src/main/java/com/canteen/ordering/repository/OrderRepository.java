package com.canteen.ordering.repository;

import com.canteen.ordering.model.Order;
import com.canteen.ordering.model.OrderStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface OrderRepository extends JpaRepository<Order, Long> {

    List<Order> findAllByOrderByCreatedAtDesc();

    List<Order> findByStatusOrderByCreatedAtDesc(OrderStatus status);

    long countByStatus(OrderStatus status);

    /**
     * The next queue number is based on the highest number issued so far.
     * Using MAX (instead of COUNT) keeps numbers unique even if an order
     * is ever removed.
     */
    @Query("select coalesce(max(o.queueNumber), 0) from Order o")
    int findMaxQueueNumber();
}
